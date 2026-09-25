"use client";

import { useEffect, useRef } from "react";
import { watch as copy } from "../constants/copy.th";
import { ChoiceButton, type ChoiceStatus } from "./ChoiceButton";
import { Modal } from "@/frontend/shared/ui/Modal";
import { Spinner } from "@/frontend/shared/ui/Button";
import type { QuizStep } from "../state/watch.machine";
import type { PublicQuestion } from "@/shared/contracts/session";

export interface QuizModalProps {
  open: boolean;
  question: PublicQuestion | null;
  questionNumber: number;
  totalQuestions: number;
  phase: QuizStep | null;
  pendingChoice: string | null;
  wrongChoiceLabels: string[];
  feedback: { tone: "wrong" | "correct" | "error"; message: string } | null;
  onChoose: (label: string) => void;
}

function choiceStatus(label: string, phase: QuizStep | null, pendingChoice: string | null, wrongChoiceLabels: string[]): ChoiceStatus {
  if (phase === "submitting" && pendingChoice === label) return "submitting";
  if (wrongChoiceLabels.includes(label)) return "wrong";
  return "default";
}

export function QuizModal({ open, question, questionNumber, totalQuestions, phase, pendingChoice, wrongChoiceLabels, feedback, onChoose }: QuizModalProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  if (!question) return null;
  // Only "answering" accepts a choice. The old reducer nulled currentQuestionId on a correct
  // answer, closing the modal outright; the machine instead keeps the modal open through the
  // 900ms "correct" step (matches spec), so a tap must be rejected here too — otherwise a second
  // tap during that window sends a second /answer, which the server rejects as NOT_AT_QUIZ.
  const disabled = phase !== "answering";

  return (
    <Modal open={open} mode="sheet" dismissible={false} labelledBy="quiz-title" describedBy="quiz-prompt">
      <div style={{ padding: "24px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{copy.quizModal.eyebrow(questionNumber, totalQuestions)}</p>
          {phase === "syncing" && <Spinner size={14} />}
        </div>
        <h2 id="quiz-title" ref={titleRef} tabIndex={-1} style={{ margin: "4px 0 12px", fontSize: "var(--fs-h2)", fontWeight: 700, color: "var(--brand-primary-dark)" }}>
          {copy.quizModal.title}
        </h2>
        <p id="quiz-prompt" style={{ margin: "0 0 16px", fontSize: "var(--fs-lg)" }}>
          {question.prompt}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-busy={phase === "submitting" || undefined}>
          {question.choices.map((choice) => (
            <ChoiceButton
              key={choice.label}
              label={choice.label}
              text={choice.text}
              status={choiceStatus(choice.label, phase, pendingChoice, wrongChoiceLabels)}
              disabled={disabled || wrongChoiceLabels.includes(choice.label)}
              onClick={() => onChoose(choice.label)}
            />
          ))}
        </div>

        <div aria-live="assertive" style={{ minHeight: 20, marginTop: 12 }}>
          {phase === "syncing" && <span className="sr-only">{copy.quizModal.syncing}</span>}
          {feedback && (
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", fontWeight: 700, color: feedback.tone === "correct" ? "var(--success)" : "var(--danger)" }}>
              {feedback.message}
            </p>
          )}
        </div>

        <p style={{ margin: "8px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{copy.quizModal.helper}</p>
      </div>
    </Modal>
  );
}
