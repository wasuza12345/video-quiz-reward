// @vitest-environment jsdom
//
// Exercises useYouTubePlayer's player lifecycle against a real DOM (jsdom) with a fake YT.Player —
// the reviewer's planner lead (b) on the "refresh disables Play forever" bug: "Make the hook
// idempotent: one YT.Player per container. Destroy it in cleanup and null the ref." This is the
// one file in the suite that needs a DOM at all, so it opts into jsdom per-file rather than
// switching the whole project's default environment (vitest.config.mts stays "node").
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useYouTubePlayer } from "@/frontend/public/hooks/useYouTubePlayer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakePlayer {
  static instances: FakePlayer[] = [];
  destroyed = false;
  private container: HTMLElement;
  private events: { onReady: () => void };

  constructor(container: HTMLElement, opts: { events: { onReady: () => void } }) {
    this.container = container;
    this.events = opts.events;
    FakePlayer.instances.push(this);
    // Real YT.Player replaces the container's contents with an iframe (see VideoPlayer's
    // .yt-player-container comment) and fires onReady asynchronously, once the iframe's own
    // postMessage handshake completes — never synchronously inside the constructor.
    const iframe = document.createElement("iframe");
    container.appendChild(iframe);
    queueMicrotask(() => this.events.onReady());
  }

  playVideo() {}
  pauseVideo() {}
  seekTo() {}
  getCurrentTime() {
    return 0;
  }
  getPlayerState() {
    return 1;
  }
  setPlaybackRate() {}
  destroy() {
    this.destroyed = true;
    this.container.querySelectorAll("iframe").forEach((el) => el.remove());
  }
}

function Harness({ youtubeId }: { youtubeId: string }) {
  const { containerRef } = useYouTubePlayer({ youtubeId, title: "t", onStateChange: () => {}, onError: () => {} });
  return <div ref={containerRef} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  FakePlayer.instances = [];
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { YT?: unknown }).YT;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useYouTubePlayer lifecycle (review round: refresh disables Play forever)", () => {
  it("never constructs a player for an empty youtubeId (the WatchPage pre-session-load state)", async () => {
    act(() => root.render(<Harness youtubeId="" />));
    await flush();
    expect(FakePlayer.instances).toHaveLength(0);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("constructs exactly one player and renders exactly one iframe once youtubeId becomes real", async () => {
    act(() => root.render(<Harness youtubeId="" />));
    await flush();
    act(() => root.render(<Harness youtubeId="X7K_Xlz3T1Y" />));
    await flush();

    expect(FakePlayer.instances).toHaveLength(1);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("destroys the instance and removes its iframe on unmount (the pre-reload teardown)", async () => {
    act(() => root.render(<Harness youtubeId="X7K_Xlz3T1Y" />));
    await flush();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    act(() => root.unmount());
    expect(FakePlayer.instances[0]?.destroyed).toBe(true);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });
});
