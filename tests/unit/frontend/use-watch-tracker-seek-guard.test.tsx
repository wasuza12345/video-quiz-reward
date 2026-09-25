// @vitest-environment jsdom
//
// The anti-cheat rAF seek-guard snap-back (WatchTracker.onFrame returning "seek_guard") must be a
// pure corrective seek, never a play. The tracker's rAF loop only runs while `active` (the
// reducer thinks status is "playing"), but that's a React-state view that can be one render behind
// the REAL player: if the user clicks Pause, the real player's own getPlayerState() flips to
// PAUSED synchronously, while the loop (still `active` from the previous render) can still see a
// stale/jumped currentTime() and decide "seek_guard" on the very next frame. The old
// `player.seekTo(x, {resume:true})` call would then call playVideo() (because getPlayerState()
// wasn't PLAYING right after the seek), silently undoing the user's own Pause. `player.snapTo(x)`
// can't do that — it's a raw seekTo with no play, no guard change.
//
// Drives the REAL useWatchTracker hook against a REAL YouTubePlayerAdapter wrapping a fake raw
// YT.Player, so this exercises the actual adapter method the tracker calls, not just a mock.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWatchTracker, type UseWatchTrackerOptions } from "@/frontend/public/hooks/useWatchTracker";
import { YouTubePlayerAdapter } from "@/frontend/public/player/youtube-player-adapter";
import { YT_PLAYER_STATE, type YTPlayer } from "@/frontend/public/player/youtube-player-types";
import type { SessionWriterApi } from "@/frontend/public/hooks/useSessionWriter";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeRawPlayer implements YTPlayer {
  time = 0;
  // The real race this test pins: the player itself is already PAUSED (a real, synchronous user
  // click) while the tracker's rAF loop — still `active` from a render that hasn't caught up yet
  // — is mid-frame.
  state: number = YT_PLAYER_STATE.PAUSED;
  playVideoCallCount = 0;
  seekToCalls: number[] = [];

  getCurrentTime() {
    return this.time;
  }
  getPlayerState() {
    return this.state;
  }
  playVideo() {
    this.playVideoCallCount += 1;
  }
  pauseVideo() {}
  seekTo(seconds: number) {
    this.seekToCalls.push(seconds);
    this.time = seconds; // a real player's position actually moves — later frames must see it
  }
  setPlaybackRate() {}
  destroy() {}
}

const fakeWriter: SessionWriterApi = {
  queueTick: () => {},
  sendImmediate: async () => null,
  sendAnswer: async () => ({ failed: true, code: "network" }),
  sendClaim: async () => ({ failed: true, reason: "not_ended" }),
  flushTicks: async () => null,
  isInFlight: () => false,
};

function Harness(props: UseWatchTrackerOptions) {
  useWatchTracker(props);
  return null;
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

describe("useWatchTracker: seek_guard snap-back never re-starts playback", () => {
  it("calls player.snapTo(), never player.play()/playVideo(), even while the real player already reports PAUSED", async () => {
    const raw = new FakeRawPlayer();
    const player = new YouTubePlayerAdapter(raw, { onPlay: () => {}, onPause: () => {}, onEnded: () => {} });
    // A big forward jump (e.g. a devtools player.seekTo(40) cheat) on the very first frame, well
    // past the tracker's SEEK_GUARD_SLACK_SEC from its initial high-water mark (furthestSec: 0).
    raw.time = 40;

    act(() => {
      root.render(
        <Harness
          player={player}
          active
          sessionId="s1"
          furthestSec={0}
          pendingSeekTo={null}
          quizzes={[]}
          passedQuestionIds={[]}
          writer={fakeWriter}
          dispatch={() => {}}
        />,
      );
    });

    // One real rAF tick is enough for onFrame to see the jump and decide "seek_guard".
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(raw.seekToCalls, "the snap-back must seek the raw player back to the high-water mark").toEqual([0]);
    expect(raw.playVideoCallCount, "must never call playVideo() — that would undo the user's own in-flight Pause").toBe(0);
  }, 15_000);
});
