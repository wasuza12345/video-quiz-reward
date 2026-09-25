import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A precomputed hash nothing will ever match, at the same cost as a real one — admin login
 * compares against this when the email is unknown, so an unknown-email response takes the same
 * shape of time as a wrong-password one and doesn't leak which emails have an account (plan §7).
 * A literal, not `bcrypt.hashSync(...)` at module load (that costs ~240ms on every
 * cold start). Generated once with `bcrypt.hashSync("vq-admin-login-timing-decoy", 12)` — the
 * plaintext behind it is not a real credential and is never used to derive anything else.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$HwQwZrbFxlzU6poqF62Co.gfW/B/lx4iS38ez.J74rh.SK24TLlFy";
