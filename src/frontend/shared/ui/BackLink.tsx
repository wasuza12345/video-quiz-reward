import Link from "next/link";

export interface BackLinkProps {
  /** A deterministic parent route — never router.back(), so it can never leave the app. */
  href: string;
  /** Full display text, including the leading "←" (matches this app's existing back-link copy). */
  label: string;
}

/** shared/ui/BackLink: the one back-to-parent-page link every sub-page uses, placed above the
 * page title. Focus-visible styling comes from the global `:focus-visible` rule (globals.css) —
 * a plain <Link> already qualifies. */
export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 44,
        marginBottom: 12,
        color: "var(--brand-primary)",
        fontWeight: 600,
        fontSize: "var(--fs-sm)",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
