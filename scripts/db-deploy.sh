#!/usr/bin/env bash
# Apply prisma/migrations/*/migration.sql to the target DB (plan §9).
#   Default                        → local file DB (DATABASE_URL=file:…) via `prisma migrate deploy`.
#   TURSO_DATABASE_URL + ALLOW_TURSO=1 (or VERCEL=1) → Turso (prod). Prisma 7 CLI cannot migrate libsql://,
#                                    so scripts/db-deploy-libsql.mjs applies each pending migration.sql.
# Usage: scripts/db-deploy.sh [env-file]      e.g. ALLOW_TURSO=1 scripts/db-deploy.sh .env.local
# Never echoes URL or token values.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -ge 1 ]]; then
  [[ -f "$1" ]] || { echo "env file not found: $1" >&2; exit 1; }
  set -a; source "$1"; set +a
fi

# Same selector as src/backend/config/env.ts.
if [[ -z "${TURSO_DATABASE_URL:-}" || ( "${ALLOW_TURSO:-}" != "1" && "${VERCEL:-}" != "1" ) ]]; then
  [[ "${DATABASE_URL:-}" == file:* ]] || { echo "DATABASE_URL must be file:… when Turso is not selected" >&2; exit 1; }
  echo "target: local file DB → prisma migrate deploy"
  exec npx prisma migrate deploy
fi

: "${TURSO_AUTH_TOKEN:?TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL}"
echo "target: Turso → per-migration SQL"
exec node scripts/db-deploy-libsql.mjs
