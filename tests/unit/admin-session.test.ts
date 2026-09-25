// Pure JWT sign/verify — no DB, no Prisma. Proves the algorithm allowlist actually rejects what
// it's supposed to: an HS512-signed token (right secret, wrong alg), and the
// classic `alg: none` unsigned-token forgery, both must fail even though `jose` never even lets
// `alg: none` sign successfully — the assertion is on verification, the real attack surface.
import { CompactSign, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyAdminCookieValue } from "@/backend/common/auth/admin-session";

const SECRET = new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET);

describe("verifyAdminCookieValue — algorithm and expiry enforcement", () => {
  it("accepts a validly signed, unexpired HS256 token", async () => {
    const token = await new SignJWT({ adminId: "a1", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(SECRET);
    expect(await verifyAdminCookieValue(token)).toEqual({ adminId: "a1", tokenVersion: 0 });
  });

  it("rejects a token signed with HS512 using the same secret (algorithm not in the allowlist)", async () => {
    const token = await new SignJWT({ adminId: "a1", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(SECRET);
    expect(await verifyAdminCookieValue(token)).toBeNull();
  });

  it("rejects an `alg: none` unsigned token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ adminId: "a1", tokenVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
      "base64url",
    );
    const forged = `${header}.${payload}.`; // no signature segment — the classic alg:none forgery
    expect(await verifyAdminCookieValue(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ adminId: "a1", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600 * 9)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1h ago
      .sign(SECRET);
    expect(await verifyAdminCookieValue(token)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrongSecret = new TextEncoder().encode("a completely different secret, at least 32 bytes long");
    const token = await new SignJWT({ adminId: "a1", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(wrongSecret);
    expect(await verifyAdminCookieValue(token)).toBeNull();
  });

  it("rejects a well-formed but non-JWT string, and a missing/empty value", async () => {
    expect(await verifyAdminCookieValue("not-a-jwt")).toBeNull();
    expect(await verifyAdminCookieValue(undefined)).toBeNull();
    expect(await verifyAdminCookieValue(null)).toBeNull();
  });

  it("rejects a syntactically valid JWS whose payload is missing the expected claims", async () => {
    const token = await new CompactSign(new TextEncoder().encode(JSON.stringify({ foo: "bar" })))
      .setProtectedHeader({ alg: "HS256" })
      .sign(SECRET);
    expect(await verifyAdminCookieValue(token)).toBeNull();
  });
});
