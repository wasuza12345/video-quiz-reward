// Read-only row counts for the target DB (TURSO_DATABASE_URL if set, else DATABASE_URL file:).
// Prints table counts only — never URL or token values.
import { createClient } from "@libsql/client";

const remote = !!process.env.TURSO_DATABASE_URL;
const client = createClient(
  remote
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: process.env.DATABASE_URL },
);

const { rows } = await client.execute(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
);
const counts = {};
for (const { name } of rows) {
  const r = await client.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
  counts[name] = Number(r.rows[0].n);
}
console.log(JSON.stringify({ target: remote ? "turso" : "local-file", tables: rows.length, counts }, null, 2));
client.close();
