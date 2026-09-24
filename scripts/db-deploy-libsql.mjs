// Applies pending prisma/migrations/*/migration.sql over libsql (Turso), one batch per migration.
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment; never prints them.
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const MIGRATIONS_DIR = new URL("../prisma/migrations/", import.meta.url);

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute(
  "CREATE TABLE IF NOT EXISTS _db_deploy_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
);
const { rows } = await client.execute("SELECT name FROM _db_deploy_migrations");
const applied = new Set(rows.map((r) => r.name));

const names = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let count = 0;
for (const name of names) {
  if (applied.has(name)) {
    console.log(`skip   ${name}`);
    continue;
  }
  const sql = await readFile(new URL(`${name}/migration.sql`, MIGRATIONS_DIR), "utf8");
  // Prisma migration files are plain statements separated by ";" at line end, with "--" comments.
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  // "write" batch = one transaction: a failure leaves no half-applied migration.
  await client.batch(
    [...statements, { sql: "INSERT INTO _db_deploy_migrations (name) VALUES (?)", args: [name] }],
    "write",
  );
  console.log(`apply  ${name} (${statements.length} statements)`);
  count++;
}
console.log(`done: ${count} applied`);
client.close();
