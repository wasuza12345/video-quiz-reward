import { formatTime, watch as copy } from "../constants/copy.th";
import type { PublicQuestion } from "@/shared/contracts/session";

export interface WatchProgressProps {
  positionSec: number;
  furthestSec: number;
  durationSec: number;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
}

/** Read-only: fill = position, lighter band = watched ground up to furthestSec, plus quiz markers. */
export function WatchProgress({ positionSec, furthestSec, durationSec, quizzes, passedQuestionIds }: WatchProgressProps) {
  const pct = (v: number) => (durationSec > 0 ? Math.min(100, Math.max(0, (v / durationSec) * 100)) : 0);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-valuenow={positionSec}
      aria-valuetext={copy.controlBar.progressAriaValueText(formatTime(positionSec), formatTime(durationSec))}
      style={{ position: "relative", height: 8, borderRadius: "var(--radius-pill)", background: "var(--track)", cursor: "default", overflow: "visible" }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${pct(furthestSec)}%`, background: "#1d379333" }} />
        <div style={{ position: "absolute", inset: 0, width: `${pct(positionSec)}%`, background: "var(--brand-primary)" }} />
      </div>
      {quizzes.map((q) => {
        const passed = passedQuestionIds.includes(q.id);
        return (
          <span
            key={q.id}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${pct(q.triggerSec)}%`,
              top: "50%",
              transform: passed ? "translate(-50%, -50%)" : "translate(-50%, -50%) rotate(45deg)",
              width: passed ? 14 : 12,
              height: passed ? 14 : 12,
              borderRadius: passed ? "50%" : 2,
              background: passed ? "var(--success)" : "var(--brand-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {passed && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
          </span>
        );
      })}
    </div>
  );
}
