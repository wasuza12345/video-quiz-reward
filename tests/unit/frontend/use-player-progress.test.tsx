// @vitest-environment jsdom
//
// Planner task: the progress bar/time label must follow the local player in real time instead of
// only moving on a server TICK response (up to 5s stale). Renders LiveControlBar directly against
// a fake player whose getCurrentTime() advances with real wall-clock time — no api/server mocking
// at all, so a passing assertion here can only be explained by the display reading the player
// itself, never a response.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveControlBar } from "@/frontend/public/components/LiveControlBar";
import { usePlayerProgress, type UsePlayerProgressOptions } from "@/frontend/public/hooks/usePlayerProgress";
import type { YTPlayer } from "@/frontend/public/hooks/useYouTubePlayer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakePlayer implements YTPlayer {
  private readonly startedAtMs: number;
  private readonly startPositionSec: number;

  constructor(startPositionSec: number) {
    this.startedAtMs = performance.now();
    this.startPositionSec = startPositionSec;
  }

  getCurrentTime(): number {
    return this.startPositionSec + (performance.now() - this.startedAtMs) / 1000;
  }

  playVideo() {}
  pauseVideo() {}
  seekTo() {}
  getPlayerState() {
    return 1;
  }
  setPlaybackRate() {}
  destroy() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function progressBarValue(): number {
  const bar = container.querySelector('[role="progressbar"]');
  if (!bar) throw new Error("progress bar not rendered");
  return Number(bar.getAttribute("aria-valuenow"));
}

describe("LiveControlBar tracks the local player in real time", () => {
  it("the bar's aria-valuenow advances with player.getCurrentTime() with no server response involved", async () => {
    const player = new FakePlayer(10);
    act(() => {
      root.render(
        <LiveControlBar
          player={player}
          active
          fallbackPositionSec={10}
          fallbackFurthestSec={10}
          getMaxReached={() => player.getCurrentTime()}
          isPlaying
          enabled
          onToggle={() => {}}
          durationSec={44}
          quizzes={[]}
          passedQuestionIds={[]}
        />,
      );
    });

    // Two checks, ~600ms apart real time — long enough for several ~100ms display ticks, short
    // enough to stay well inside the video's 44s duration.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const first = progressBarValue();
    expect(first, "must have advanced from the initial 10s well before the first check").toBeGreaterThan(10.2);
    expect(Math.abs(first - player.getCurrentTime()), "display must stay within 0.5s of the player's own current time").toBeLessThan(0.5);

    await new Promise((resolve) => setTimeout(resolve, 600));
    const second = progressBarValue();
    expect(second, "must keep advancing on the next check too").toBeGreaterThan(first);
    expect(Math.abs(second - player.getCurrentTime()), "display must stay within 0.5s of the player's own current time").toBeLessThan(0.5);
  }, 15_000);

  it("falls back to the server-synced position while there is no player yet", () => {
    act(() => {
      root.render(
        <LiveControlBar
          player={null}
          active={false}
          fallbackPositionSec={7}
          fallbackFurthestSec={7}
          getMaxReached={() => 0}
          isPlaying={false}
          enabled={false}
          onToggle={() => {}}
          durationSec={44}
          quizzes={[]}
          passedQuestionIds={[]}
        />,
      );
    });

    expect(progressBarValue()).toBe(7);
  });

  it("shows the frozen player time (not the stale server position) while paused", () => {
    const player = new FakePlayer(12);
    act(() => {
      root.render(
        <LiveControlBar
          player={player}
          active={false}
          fallbackPositionSec={5} // deliberately stale/different from the player's real position
          fallbackFurthestSec={5}
          getMaxReached={() => player.getCurrentTime()}
          isPlaying={false}
          enabled
          onToggle={() => {}}
          durationSec={44}
          quizzes={[]}
          passedQuestionIds={[]}
        />,
      );
    });

    expect(Math.abs(progressBarValue() - player.getCurrentTime())).toBeLessThan(0.5);
  });
});

/** A manually-controlled player: currentTime is set directly by the test (no wall-clock advance),
 * and every read is counted — needed to prove both the exact snap-back value and that nothing
 * polls getCurrentTime() while inactive/unmounted. */
class ManualPlayer implements YTPlayer {
  currentTime: number;
  getCurrentTimeCallCount = 0;

  constructor(startPositionSec: number) {
    this.currentTime = startPositionSec;
  }

  getCurrentTime(): number {
    this.getCurrentTimeCallCount += 1;
    return this.currentTime;
  }

  playVideo() {}
  pauseVideo() {}
  seekTo() {}
  getPlayerState() {
    return 1;
  }
  setPlaybackRate() {}
  destroy() {}
}

function ProgressProbe(props: UsePlayerProgressOptions) {
  const { positionSec, furthestSec } = usePlayerProgress(props);
  return <div data-testid="probe" data-position={positionSec} data-furthest={furthestSec} />;
}

function probeFurthest(): number {
  const el = container.querySelector('[data-testid="probe"]');
  if (!el) throw new Error("probe not rendered");
  return Number(el.getAttribute("data-furthest"));
}

function probePosition(): number {
  const el = container.querySelector('[data-testid="probe"]');
  if (!el) throw new Error("probe not rendered");
  return Number(el.getAttribute("data-position"));
}

describe("usePlayerProgress: progress band never shrinks", () => {
  it("the watched band never goes below the server furthestSec after a backward reconcile", async () => {
    // getMaxReached simulates the tracker having just been reconcile()'d down to a resumed/
    // seeked-to position (reducer:170's resume-with-positionSec<furthestSec, or reducer:301's
    // ENDED_NOT_WATCHED) — well below the server-confirmed furthestSec passed as the fallback.
    const player = new ManualPlayer(5);
    act(() => {
      root.render(<ProgressProbe player={player} active fallbackPositionSec={5} fallbackFurthestSec={20} getMaxReached={() => 5} />);
    });

    // Before the first rAF tick lands: the "no live snapshot yet" branch must already floor it.
    expect(probeFurthest(), "must never show less than the server furthestSec, even before the first tick").toBe(20);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(probeFurthest(), "must still be floored at the server furthestSec after ticking").toBe(20);
  });

  it("follows the player backward within 250ms (a rejected-seek snap-back, e.g. 12 -> 8, while playing)", async () => {
    const player = new ManualPlayer(12);
    act(() => {
      root.render(<ProgressProbe player={player} active fallbackPositionSec={12} fallbackFurthestSec={12} getMaxReached={() => player.getCurrentTime()} />);
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(probePosition(), "must show the initial position before the seek").toBe(12);

    player.currentTime = 8; // simulates WatchPage's pendingSeekTo effect calling player.seekTo(8)
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(probePosition(), "must follow the player back down within 250ms, not stay stuck at 12").toBe(8);
  });

  it("makes zero getCurrentTime() calls 400ms after active turns false", async () => {
    const player = new ManualPlayer(5);
    act(() => {
      root.render(<ProgressProbe player={player} active={false} fallbackPositionSec={5} fallbackFurthestSec={5} getMaxReached={() => player.getCurrentTime()} />);
    });
    const callsAfterMount = player.getCurrentTimeCallCount;

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(player.getCurrentTimeCallCount, "no rAF polling should run while inactive — a paused/quiz_open player isn't advancing").toBe(callsAfterMount);
  });

  it("makes zero getCurrentTime() calls 400ms after unmount", async () => {
    const player = new ManualPlayer(5);
    act(() => {
      root.render(<ProgressProbe player={player} active fallbackPositionSec={5} fallbackFurthestSec={5} getMaxReached={() => player.getCurrentTime()} />);
    });

    await new Promise((resolve) => setTimeout(resolve, 250)); // a couple of ticks, proves polling was actually running
    expect(player.getCurrentTimeCallCount, "the loop must have been ticking before unmount").toBeGreaterThan(0);

    act(() => root.unmount());
    const callsAtUnmount = player.getCurrentTimeCallCount;

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(player.getCurrentTimeCallCount, "the rAF loop must be cancelled on unmount, not leak").toBe(callsAtUnmount);
  });
});
