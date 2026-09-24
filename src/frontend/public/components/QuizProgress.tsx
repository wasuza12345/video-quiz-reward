import { formatTime, watch as copy } from "../constants/copy.th";
import type { PublicQuestion } from "@/shared/contracts/session";

export interface QuizProgressProps {
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
}

/** Inline row ≥ 601px (spec §4.3.4); hidden entirely when there are no quizzes. */
export function QuizProgress({ quizzes, passedQuestionIds }: QuizProgressProps) {
  if (quizzes.length === 0) return null;
  return (
    <ul style={{ display: "flex", gap: 12, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
      {quizzes.map((q, i) => {
        const passed = passedQuestionIds.includes(q.id);
        return (
          <li key={q.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--fs-sm)", color: passed ? "var(--success)" : "var(--text-2)" }}>
            <span aria-hidden="true">{passed ? "✓" : "○"}</span>
            <span>{copy.quizProgress.chip(i + 1, formatTime(q.triggerSec))}</span>
          </li>
        );
      })}
    </ul>
  );
}
