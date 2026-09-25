import { describe, expect, it } from "vitest";
import { nextUnpassedQuestion } from "@/shared/rules/quiz-gate";

describe("nextUnpassedQuestion", () => {
  const questions = [
    { id: "late", triggerSec: 30 },
    { id: "early", triggerSec: 10 },
  ];

  it("picks the earliest unpassed question, whatever the input order", () => {
    expect(nextUnpassedQuestion(questions, [])?.id).toBe("early");
    expect(nextUnpassedQuestion(questions, ["early"])?.id).toBe("late");
    expect(nextUnpassedQuestion(questions, ["early", "late"])).toBeNull();
  });
});
