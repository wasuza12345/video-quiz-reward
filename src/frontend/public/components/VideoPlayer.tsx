import type { ReactNode } from "react";

export interface VideoPlayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Shows the centre ▶ overlay (ready/paused/replay-ended — spec §4.2). */
  showCentrePlay: boolean;
  onShieldClick: () => void;
  shieldLabel: string;
  overlay?: ReactNode;
}

/**
 * 16:9 box holding the YouTube iframe plus a transparent click shield over it — YouTube's own UI
 * is never reachable, taps route through our handler so the reducer stays in sync (plan §6).
 */
export function VideoPlayer({ containerRef, showCentrePlay, onShieldClick, shieldLabel, overlay }: VideoPlayerProps) {
  return (
    <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: "var(--radius-media)", overflow: "hidden", background: "#000" }}>
      <div ref={containerRef} className="yt-player-container" style={{ position: "absolute", inset: 0 }} />
      <button
        type="button"
        aria-label={shieldLabel}
        onClick={onShieldClick}
        style={{ position: "absolute", inset: 0, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        {showCentrePlay && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        )}
      </button>
      {overlay}
    </div>
  );
}
