import { header as copy } from "../constants/copy.th";

/** Optional, minimal (spec §2.1). */
export function PublicFooter() {
  return (
    <footer style={{ background: "var(--brand-primary)", color: "rgba(255,255,255,0.9)", fontSize: "var(--fs-xs)", textAlign: "center", padding: "16px var(--gutter)" }}>
      {copy.footer}
    </footer>
  );
}
