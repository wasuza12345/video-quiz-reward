import { describe, expect, it } from "vitest";
import { resolveBackHref, withFromParam } from "@/frontend/admin/lib/backHref";

describe("withFromParam", () => {
  it("appends the list's current query string as ?from= when there is one", () => {
    const params = new URLSearchParams("flagged=true&page=2");
    expect(withFromParam("/admin/sessions/s1", "/admin/sessions", params)).toBe(
      `/admin/sessions/s1?from=${encodeURIComponent("/admin/sessions?flagged=true&page=2")}`,
    );
  });

  it("leaves the link plain when the list has no filters (an empty query string)", () => {
    const params = new URLSearchParams("");
    expect(withFromParam("/admin/sessions/s1", "/admin/sessions", params)).toBe("/admin/sessions/s1");
  });

  it("uses & to extend a detailHref that already carries its own query string", () => {
    const params = new URLSearchParams("page=2");
    expect(withFromParam("/admin/sessions/s1?tab=timeline", "/admin/sessions", params)).toBe(
      `/admin/sessions/s1?tab=timeline&from=${encodeURIComponent("/admin/sessions?page=2")}`,
    );
  });
});

describe("resolveBackHref", () => {
  it("uses `from` when it's a same-app relative path back to the given list", () => {
    expect(resolveBackHref("/admin/sessions?flagged=true", "/admin/sessions")).toBe("/admin/sessions?flagged=true");
  });

  it("falls back to the plain list route when there's no `from`", () => {
    expect(resolveBackHref(null, "/admin/sessions")).toBe("/admin/sessions");
  });

  it("falls back to the plain list route when `from` points somewhere else entirely (never trusted blindly)", () => {
    expect(resolveBackHref("https://evil.example/phish", "/admin/sessions")).toBe("/admin/sessions");
    expect(resolveBackHref("/admin/users?page=2", "/admin/sessions")).toBe("/admin/sessions");
  });

  it("falls back to the plain list route for a bare list path with no query string (not the `?`-prefixed shape from() produces)", () => {
    expect(resolveBackHref("/admin/sessions", "/admin/sessions")).toBe("/admin/sessions");
  });
});
