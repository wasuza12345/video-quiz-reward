import { formatTime, watch as copy } from "../constants/copy.th";
import { WatchProgress } from "./WatchProgress";
import type { PublicQuestion } from "@/shared/contracts/session";

export interface ControlBarProps {
  isPlaying: boolean;
  enabled: boolean;
  onToggle: () => void;
  positionSec: number;
  furthestSec: number;
  durationSec: number;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
}

export function ControlBar({ isPlaying, enabled, onToggle, positionSec, furthestSec, durationSec, quizzes, passedQuestionIds }: ControlBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 56 }}>
      <button
        type="button"
        aria-label={isPlaying ? copy.controlBar.pauseAriaLabel : copy.controlBar.playAriaLabel}
        aria-disabled={!enabled || undefined}
        disabled={!enabled}
        onClick={onToggle}
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: "50%",
          border: "none",
          background: "var(--brand-accent)",
          color: "#fff",
          boxShadow: enabled ? "var(--shadow-cta)" : "none",
          opacity: enabled ? 1 : 0.4,
          cursor: enabled ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <span className="tabular-nums" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", flexShrink: 0 }}>
        {formatTime(positionSec)} / {formatTime(durationSec)}
      </span>

      <div style={{ flex: 1 }}>
        <WatchProgress positionSec={positionSec} furthestSec={furthestSec} durationSec={durationSec} quizzes={quizzes} passedQuestionIds={passedQuestionIds} />
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}
