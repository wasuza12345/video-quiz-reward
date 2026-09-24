export interface ProgressBarProps {
  value: number;
  max: number;
  valueText: string;
  secondaryValue?: number;
  height?: number;
}

/** Read-only progress bar (WatchProgress base, admin mini bars). Not focusable, no pointer handlers. */
export function ProgressBar({ value, max, valueText, secondaryValue, height = 8 }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const secondaryPct = secondaryValue !== undefined && max > 0 ? Math.min(100, Math.max(0, (secondaryValue / max) * 100)) : null;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      style={{ position: "relative", height, borderRadius: "var(--radius-pill)", background: "var(--track)", cursor: "default", overflow: "hidden" }}
    >
      {secondaryPct !== null && (
        <div style={{ position: "absolute", inset: 0, width: `${secondaryPct}%`, background: "#1d379333", borderRadius: "inherit" }} />
      )}
      <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "var(--brand-primary)", borderRadius: "inherit" }} />
    </div>
  );
}
