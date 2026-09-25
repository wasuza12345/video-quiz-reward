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
