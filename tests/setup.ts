import "dotenv/config";

// The only Turso DB is production: tests always run on the local file DB.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
if (!process.env.DATABASE_URL?.startsWith("file:")) {
  throw new Error("Tests need DATABASE_URL=file:… (local SQLite)");
}
