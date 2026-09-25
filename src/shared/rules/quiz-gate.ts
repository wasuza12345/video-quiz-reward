// The quiz-gate rule (plan §6): the earliest question not yet passed. Backend and frontend both
// import this so the client's local gate check and the server's authoritative one can't drift.
export interface QuizGateQuestion {
  id: string;
  triggerSec: number;
}

/** The earliest question not yet passed, or null when all are passed. */
export function nextUnpassedQuestion<T extends QuizGateQuestion>(questions: T[], passedQuestionIds: string[]): T | null {
  let next: T | null = null;
  for (const q of questions) {
    if (passedQuestionIds.includes(q.id)) continue;
    if (!next || q.triggerSec < next.triggerSec) next = q;
  }
  return next;
}
