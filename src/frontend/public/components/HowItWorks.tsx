const STEPS = [
  { icon: "▶", text: "ดูคลิปให้จบ" },
  { icon: "?", text: "ตอบคำถามระหว่างดู" },
  { icon: "⭐", text: "รับแต้มสะสมทันที" },
];

/** ①②③ steps, stacked ≤ 1024, in a row ≥ 1025 (spec §4.1). */
export function HowItWorks() {
  return (
    <ol
      style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none", margin: 0, padding: 0 }}
      className="how-it-works"
    >
      {STEPS.map((step, i) => (
        <li key={step.text} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: "50%",
              background: "var(--info-bg)",
              color: "var(--brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "var(--fs-sm)",
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}
