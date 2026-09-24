export interface StatusLineProps {
  text: string;
}

/** One line under the ControlBar, `aria-live="polite"` (spec §4.3.3). */
export function StatusLine({ text }: StatusLineProps) {
  if (!text) return null;
  return (
    <p aria-live="polite" style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
      {text}
    </p>
  );
}
