import { watch as copy } from "../constants/copy.th";
import { Spinner } from "@/frontend/shared/ui/Button";

export type ChoiceStatus = "default" | "submitting" | "wrong" | "correct";

export interface ChoiceButtonProps {
  label: string;
  text: string;
  status: ChoiceStatus;
  disabled: boolean;
  onClick: () => void;
}

export function ChoiceButton({ label, text, status, disabled, onClick }: ChoiceButtonProps) {
  const tone =
    status === "wrong"
      ? { bg: "var(--danger-bg)", border: "var(--danger)" }
      : status === "correct"
        ? { bg: "var(--success-bg)", border: "var(--success)" }
        : { bg: "var(--surface)", border: "var(--border-control)" };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={disabled || undefined}
      disabled={disabled && status !== "wrong" && status !== "correct"}
      aria-label={copy.quizModal.choiceAriaLabel(label, text) + (status === "wrong" ? copy.quizModal.wrongSrSuffix : "")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 56,
        padding: "8px 16px",
        borderRadius: 16,
        border: `1.5px solid ${tone.border}`,
        background: tone.bg,
        fontSize: "var(--fs-md)",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && status === "default" ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: "50%",
          border: `1.5px solid ${tone.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "var(--fs-sm)",
        }}
      >
        {status === "submitting" ? <Spinner size={16} /> : status === "wrong" ? "✕" : status === "correct" ? "✓" : label}
      </span>
      <span>{text}</span>
    </button>
  );
}
