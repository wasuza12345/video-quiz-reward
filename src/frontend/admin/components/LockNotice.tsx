import { lockNotice as copy } from "../constants/copy.th";

export function LockNotice({ sessionCount, id }: { sessionCount: number; id?: string }) {
  return (
    <div id={id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "var(--warning-bg)", borderLeft: "4px solid var(--warning)", borderRadius: 12, padding: "12px 16px" }}>
      <span aria-hidden="true">🔒</span>
      <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--warning)" }}>{copy.title(sessionCount)}</p>
    </div>
  );
}
