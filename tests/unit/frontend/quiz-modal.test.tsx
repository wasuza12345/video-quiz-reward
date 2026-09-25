// @vitest-environment jsdom
//
// Reviewer MINOR on #12: QuizModal's own `disabled = phase !== "answering"` check (added in #12's
// MAJOR-1 fixup) has no direct unit coverage — only exercised indirectly through WatchPage
// integration tests. Pins it directly for "correct" (the step whose disabled-choices requirement
// was the actual #12 MAJOR-1 bug: a second tap during the 900ms post-correct window) and for
// "submitting"/"syncing" for completeness. "resuming" (#12b's own new addition) is deliberately
// NOT a QuizStep — see watch.machine.ts's header comment — so it never reaches QuizModal: the
// modal has already closed (QUIZ_RESUME_AFTER_CORRECT always leaves phase "quiz") by the time the
// resume attempt starts, which is what selectPlayButtonEnabled + WatchPage's own
// watch-page-auto-resuming-backstop.test.tsx cover instead.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizModal } from "@/frontend/public/components/QuizModal";
import type { QuizStep } from "@/frontend/public/state/watch.machine";

const QUESTION = {
  id: "q1",
  triggerSec: 13,
  prompt: "คำถามทดสอบ",
  choices: [
    { label: "A", text: "choice-a-text" },
    { label: "D", text: "choice-d-text" },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderAt(phase: QuizStep) {
  act(() => {
    root.render(
      <QuizModal
        open
        question={QUESTION}
        questionNumber={1}
        totalQuestions={1}
        phase={phase}
        pendingChoice={null}
        wrongChoiceLabels={[]}
        feedback={phase === "correct" ? { tone: "correct", message: "ถูกต้อง" } : null}
        onChoose={() => {}}
      />,
    );
  });
}

function choiceButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

describe("QuizModal: choices are disabled outside step 'answering'", () => {
  it("phase 'correct' — every choice button is disabled", () => {
    renderAt("correct");
    const buttons = choiceButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled, `${b.textContent} must be disabled during 'correct'`).toBe(true);
  });

  it("phase 'submitting' — every choice button is disabled", () => {
    renderAt("submitting");
    for (const b of choiceButtons()) expect(b.disabled).toBe(true);
  });

  it("phase 'syncing' — every choice button is disabled", () => {
    renderAt("syncing");
    for (const b of choiceButtons()) expect(b.disabled).toBe(true);
  });

  it("phase 'answering' — choice buttons are enabled (sanity: the guard isn't just always-on)", () => {
    renderAt("answering");
    const buttons = choiceButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled).toBe(false);
  });

  it("a click during 'correct' never reaches onChoose", () => {
    const onChoose = vi.fn();
    act(() => {
      root.render(
        <QuizModal
          open
          question={QUESTION}
          questionNumber={1}
          totalQuestions={1}
          phase="correct"
          pendingChoice={null}
          wrongChoiceLabels={[]}
          feedback={{ tone: "correct", message: "ถูกต้อง" }}
          onChoose={onChoose}
        />,
      );
    });
    const btn = choiceButtons()[0];
    act(() => btn.click());
    expect(onChoose).not.toHaveBeenCalled();
  });
});
