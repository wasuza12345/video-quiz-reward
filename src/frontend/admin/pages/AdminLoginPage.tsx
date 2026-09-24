"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/frontend/shared/ui/Button";
import { IconButton } from "@/frontend/shared/ui/IconButton";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { shell, login as copy } from "../constants/copy.th";
import { AdminApiError, adminApi } from "../services/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Notice = { tone: "danger" | "warning" | "info" | "success"; message: string } | null;

function initialNotice(reason: string | null): Notice {
  if (reason === "expired") return { tone: "info", message: copy.reasonExpired };
  if (reason === "logout") return { tone: "success", message: copy.reasonLogout };
  return null;
}

export function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const redirectTo = nextPath && nextPath.startsWith("/admin") ? nextPath : "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(() => initialNotice(searchParams.get("reason")));
  const [throttled, setThrottled] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const clearFieldErrors = () => {
    setEmailError(null);
    setPasswordError(null);
    setThrottled(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (throttled) return;

    let hasError = false;
    if (!email.trim()) {
      setEmailError(copy.validation.emailRequired);
      hasError = true;
    } else if (!EMAIL_RE.test(email.trim())) {
      setEmailError(copy.validation.emailInvalid);
      hasError = true;
    } else {
      setEmailError(null);
    }
    if (!password) {
      setPasswordError(copy.validation.passwordRequired);
      hasError = true;
    } else {
      setPasswordError(null);
    }
    if (hasError) return;

    setSubmitting(true);
    setNotice(null);
    try {
      await adminApi.login({ email: email.trim(), password });
      router.push(redirectTo);
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.code === "INVALID_CREDENTIALS") {
          setNotice({ tone: "danger", message: copy.errors.invalidCredentials });
          setPassword("");
          passwordRef.current?.focus();
        } else if (err.code === "TOO_MANY_ATTEMPTS") {
          setNotice({ tone: "warning", message: copy.errors.tooManyAttempts });
          setThrottled(true);
        } else if (err.code === "BAD_ORIGIN") {
          setNotice({ tone: "danger", message: copy.errors.badOrigin });
        } else {
          setNotice({ tone: "danger", message: copy.errors.network });
        }
      } else {
        setNotice({ tone: "danger", message: copy.errors.network });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-admin)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <p style={{ textAlign: "center", fontWeight: 700, color: "var(--brand-primary-dark)", marginBottom: 24 }}>{shell.appName}</p>
        <div style={{ background: "var(--surface)", borderRadius: 16, padding: 24, boxShadow: "var(--shadow-card)" }}>
          <h1 style={{ fontSize: "var(--fs-h1)", fontWeight: 700, margin: "0 0 16px" }}>{copy.title}</h1>

          {notice && (
            <div style={{ marginBottom: 16 }}>
              <InlineNotice tone={notice.tone} role={notice.tone === "danger" || notice.tone === "warning" ? "alert" : "status"}>
                {notice.message}
              </InlineNotice>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="admin-email" style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>
                {copy.emailLabel}
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldErrors();
                }}
                readOnly={submitting}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "admin-email-error" : undefined}
                style={{
                  width: "100%",
                  height: 48,
                  borderRadius: "var(--radius-field)",
                  border: `1px solid ${emailError ? "var(--danger)" : "var(--border-control)"}`,
                  padding: "0 14px",
                  fontSize: "var(--fs-md)",
                  fontFamily: "var(--font)",
                }}
              />
              {emailError && (
                <p id="admin-email-error" style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
                  {emailError}
                </p>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="admin-password" style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>
                {copy.passwordLabel}
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="admin-password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldErrors();
                  }}
                  readOnly={submitting}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? "admin-password-error" : undefined}
                  style={{
                    width: "100%",
                    height: 48,
                    borderRadius: "var(--radius-field)",
                    border: `1px solid ${passwordError ? "var(--danger)" : "var(--border-control)"}`,
                    padding: "0 48px 0 14px",
                    fontSize: "var(--fs-md)",
                    fontFamily: "var(--font)",
                  }}
                />
                <div style={{ position: "absolute", right: 2, top: 2 }}>
                  <IconButton
                    type="button"
                    aria-label={showPassword ? copy.hidePasswordAriaLabel : copy.showPasswordAriaLabel}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        {showPassword ? (
                          <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0112 5c5 0 9 4 10 7-.4 1.1-1.1 2.3-2.1 3.4M6.6 6.6C4.6 8 3.2 10 2 12c1 3 5 7 10 7 1.3 0 2.5-.3 3.6-.7" />
                        ) : (
                          <>
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    }
                  />
                </div>
              </div>
              {passwordError && (
                <p id="admin-password-error" style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
                  {passwordError}
                </p>
              )}
            </div>

            <Button type="submit" variant="primary-navy" loading={submitting} disabled={throttled} style={{ width: "100%" }}>
              {submitting ? copy.submitting : copy.submit}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
