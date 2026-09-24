import { describe, expect, it } from "vitest";
import { getDbEnv, getEnv } from "@/backend/config/env";

const secret = "x".repeat(32);
const local = { DATABASE_URL: "file:./dev.db" };
const turso = { TURSO_DATABASE_URL: "libsql://t", TURSO_AUTH_TOKEN: "tok" };
const LOCAL_DB = { url: "file:./dev.db", authToken: undefined, isRemote: false };
const TURSO_DB = { url: "libsql://t", authToken: "tok", isRemote: true };

describe("env: DB selector", () => {
  it("uses the local file DB when TURSO_DATABASE_URL is unset", () => {
    expect(getDbEnv({ ...local, TURSO_DATABASE_URL: "", ALLOW_TURSO: "1" })).toEqual(LOCAL_DB);
  });

  it("ignores TURSO_* without VERCEL=1 or ALLOW_TURSO=1 (e.g. .env.local on a laptop)", () => {
    expect(getDbEnv({ ...local, ...turso })).toEqual(LOCAL_DB);
    expect(getDbEnv({ ...local, ...turso, ALLOW_TURSO: "0", VERCEL: "" })).toEqual(LOCAL_DB);
  });

  it("uses Turso with ALLOW_TURSO=1", () => {
    expect(getDbEnv({ ...local, ...turso, ALLOW_TURSO: "1" })).toEqual(TURSO_DB);
  });

  it("uses Turso on Vercel (VERCEL=1)", () => {
    expect(getDbEnv({ ...turso, VERCEL: "1" })).toEqual(TURSO_DB);
  });

  it("requires TURSO_AUTH_TOKEN when Turso is selected", () => {
    expect(() => getDbEnv({ TURSO_DATABASE_URL: "libsql://t", ALLOW_TURSO: "1" })).toThrow(/TURSO_AUTH_TOKEN/);
  });

  it("rejects a non-file DATABASE_URL when Turso is not selected", () => {
    expect(() => getDbEnv({ DATABASE_URL: "libsql://t" })).toThrow(/DATABASE_URL/);
    expect(() => getDbEnv({ ...turso })).toThrow(/DATABASE_URL/);
  });
});

describe("env: secrets", () => {
  it("rejects secrets shorter than 32 characters and never echoes values", () => {
    const run = () => getEnv({ ...local, ADMIN_SESSION_SECRET: "short-secret-value", USER_COOKIE_SECRET: secret });
    expect(run).toThrow(/ADMIN_SESSION_SECRET/);
    expect(run).not.toThrow(/short-secret-value/);
    expect(getEnv({ ...local, ADMIN_SESSION_SECRET: secret, USER_COOKIE_SECRET: secret }).db.isRemote).toBe(false);
  });
});
