import { describe, expect, it } from "vitest";
import { getDbEnv, getEnv } from "@/backend/config/env";

const secret = "x".repeat(32);

describe("env", () => {
  it("uses the local file DB when TURSO_DATABASE_URL is unset", () => {
    expect(getDbEnv({ DATABASE_URL: "file:./dev.db", TURSO_DATABASE_URL: "" })).toEqual({
      url: "file:./dev.db",
      authToken: undefined,
      isRemote: false,
    });
  });

  it("prefers Turso when TURSO_DATABASE_URL is set", () => {
    const env = getDbEnv({ DATABASE_URL: "file:./dev.db", TURSO_DATABASE_URL: "libsql://t", TURSO_AUTH_TOKEN: "tok" });
    expect(env).toEqual({ url: "libsql://t", authToken: "tok", isRemote: true });
  });

  it("requires TURSO_AUTH_TOKEN with TURSO_DATABASE_URL", () => {
    expect(() => getDbEnv({ TURSO_DATABASE_URL: "libsql://t" })).toThrow(/TURSO_AUTH_TOKEN/);
  });

  it("rejects a non-file DATABASE_URL without Turso", () => {
    expect(() => getDbEnv({ DATABASE_URL: "libsql://t" })).toThrow(/DATABASE_URL/);
  });

  it("rejects secrets shorter than 32 characters and never echoes values", () => {
    const run = () =>
      getEnv({ DATABASE_URL: "file:./dev.db", ADMIN_SESSION_SECRET: "short-secret-value", USER_COOKIE_SECRET: secret });
    expect(run).toThrow(/ADMIN_SESSION_SECRET/);
    expect(run).not.toThrow(/short-secret-value/);
    expect(getEnv({ DATABASE_URL: "file:./dev.db", ADMIN_SESSION_SECRET: secret, USER_COOKIE_SECRET: secret }).db.isRemote)
      .toBe(false);
  });
});
