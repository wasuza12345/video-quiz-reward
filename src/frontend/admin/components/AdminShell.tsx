"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/frontend/shared/ui/Button";
import { ErrorState } from "@/frontend/shared/ui/ErrorState";
import { IconButton } from "@/frontend/shared/ui/IconButton";
import { shell } from "../constants/copy.th";
import { AdminApiError, adminApi } from "../services/api";

const NAV_ITEMS = [
  { href: "/admin", label: shell.nav.dashboard, match: (p: string) => p === "/admin" },
  { href: "/admin/videos", label: shell.nav.videos, match: (p: string) => p.startsWith("/admin/videos") },
  { href: "/admin/users", label: shell.nav.users, match: (p: string) => p.startsWith("/admin/users") },
  { href: "/admin/sessions", label: shell.nav.sessions, match: (p: string) => p.startsWith("/admin/sessions") },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              height: 48,
              padding: "0 20px",
              color: "#fff",
              textDecoration: "none",
              fontWeight: active ? 700 : 400,
              background: active ? "rgba(255,255,255,0.12)" : "transparent",
              borderLeft: active ? "4px solid #fff" : "4px solid transparent",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function PageHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      <h1 style={{ fontSize: "var(--fs-h1)", fontWeight: 700, margin: 0 }}>{title}</h1>
      {action}
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [meError, setMeError] = useState(false);
  const [meRetryKey, setMeRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setEmail(me.email);
        setMeError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Tester audit MINOR 3: a network error, timeout or 5xx used to be treated exactly like
        // an expired session (401 UNAUTHENTICATED) and kicked a still-valid admin to the login
        // page. Only a real 401 redirects; anything else shows an in-shell retry instead, keeping
        // the admin on the page. Checks err.status too, not just err.code: a 401 with a non-JSON
        // body (e.g. Vercel Deployment Protection on a preview URL) has no parseable error.code
        // (AdminApiError falls back to "UNKNOWN"), which would otherwise show the retry state
        // forever for a session that's genuinely expired.
        if (err instanceof AdminApiError && (err.code === "UNAUTHENTICATED" || err.status === 401)) {
          router.push("/admin/login?reason=expired");
        } else {
          setMeError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, meRetryKey]);

  const handleLogout = () => {
    void adminApi.logout().finally(() => router.push("/admin/login?reason=logout"));
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <aside className="admin-sidebar" style={{ width: 240, flexShrink: 0, background: "var(--brand-primary)", flexDirection: "column" }}>
        <div style={{ padding: "24px 20px", color: "#fff", fontWeight: 700, fontSize: "var(--fs-md)" }}>{shell.appName}</div>
        <nav style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <NavLinks pathname={pathname} />
        </nav>
        <div style={{ padding: 20, borderTop: "1px solid rgba(255,255,255,0.16)" }}>
          {email && <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "var(--fs-xs)", margin: "0 0 12px", wordBreak: "break-all" }}>{email}</p>}
          <Button variant="outline-white" size="sm" onClick={handleLogout}>
            {shell.logout}
          </Button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header className="admin-topbar" style={{ height: 56, background: "var(--brand-primary)", alignItems: "center", padding: "0 16px", gap: 12 }}>
          <IconButton
            tone="on-navy"
            aria-label={shell.hamburgerAriaLabel}
            aria-expanded={drawerOpen}
            aria-controls="admin-drawer"
            onClick={() => setDrawerOpen(true)}
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            }
          />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: "var(--fs-sm)" }}>{shell.appName}</span>
        </header>

        {drawerOpen && (
          <div
            id="admin-drawer"
            role="dialog"
            aria-modal="true"
            style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex" }}
          >
            <div style={{ width: "60vw", maxWidth: 320, background: "var(--brand-primary)", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", padding: 8 }}>
                <IconButton
                  tone="on-navy"
                  aria-label={shell.closeDrawerAriaLabel}
                  onClick={() => setDrawerOpen(false)}
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  }
                />
              </div>
              <nav style={{ display: "flex", flexDirection: "column" }}>
                <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <div style={{ marginTop: "auto", padding: 20, borderTop: "1px solid rgba(255,255,255,0.16)" }}>
                {email && <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "var(--fs-xs)", margin: "0 0 12px", wordBreak: "break-all" }}>{email}</p>}
                <Button variant="outline-white" size="sm" onClick={handleLogout}>
                  {shell.logout}
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label={shell.closeDrawerAriaLabel}
              onClick={() => setDrawerOpen(false)}
              style={{ flex: 1, background: "var(--scrim)", border: "none", cursor: "pointer" }}
            />
          </div>
        )}

        <main style={{ flex: 1, background: "var(--bg-admin)", padding: "var(--gutter)" }}>
          {meError ? (
            <ErrorState title={shell.meError.title} body={shell.meError.body} action={{ label: shell.meError.retry, onClick: () => setMeRetryKey((k) => k + 1) }} />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
