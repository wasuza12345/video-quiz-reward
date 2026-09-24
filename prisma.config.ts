import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI (migrate/validate) reads the URL here; it only speaks to `file:` SQLite.
// Turso (libsql://) migrations go through scripts/db-deploy.sh instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
