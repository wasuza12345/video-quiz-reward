import { z } from "zod";

// Treat `KEY=""` (as in .env.example) the same as an unset variable.
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

// Turso when TURSO_DATABASE_URL is set (Vercel injects it); otherwise the local SQLite file.
const dbEnvSchema = z
  .object({
    DATABASE_URL: optionalString,
    TURSO_DATABASE_URL: optionalString,
    TURSO_AUTH_TOKEN: optionalString,
  })
  .superRefine((e, ctx) => {
    if (e.TURSO_DATABASE_URL && !e.TURSO_AUTH_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["TURSO_AUTH_TOKEN"], message: "required with TURSO_DATABASE_URL" });
    }
    if (!e.TURSO_DATABASE_URL && !e.DATABASE_URL?.startsWith("file:")) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "must be a file: URL when TURSO_DATABASE_URL is unset" });
    }
  })
  .transform((e) =>
    e.TURSO_DATABASE_URL
      ? { url: e.TURSO_DATABASE_URL, authToken: e.TURSO_AUTH_TOKEN, isRemote: true }
      : { url: e.DATABASE_URL!, authToken: undefined, isRemote: false },
  );

const secret = z.string().min(32, "must be at least 32 characters");

const secretsSchema = z.object({
  ADMIN_SESSION_SECRET: secret,
  USER_COOKIE_SECRET: secret,
});

export type DbEnv = z.infer<typeof dbEnvSchema>;
export type Env = { db: DbEnv } & z.infer<typeof secretsSchema>;

type EnvSource = Record<string, string | undefined>;

function parse<T>(schema: z.ZodType<T, unknown>, source: EnvSource): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Paths and messages only — never echo values (they may be secrets).
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

/** Database connection only — used by the Prisma client and the seed script. */
export function getDbEnv(source: EnvSource = process.env): DbEnv {
  return parse(dbEnvSchema, source);
}

/** Full app environment (DB + secrets). */
export function getEnv(source: EnvSource = process.env): Env {
  return { db: getDbEnv(source), ...parse(secretsSchema, source) };
}
