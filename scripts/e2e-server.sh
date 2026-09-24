#!/usr/bin/env bash
# Fresh file DB + seed + extra fixtures, then `next dev` on its own port — spawned by
# playwright.config.ts's webServer (tests/e2e). Never touches Turso (DATABASE_URL is file:...,
# ALLOW_TURSO/VERCEL are unset).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -f e2e.db e2e.db-journal e2e.db-wal e2e.db-shm

npm run db:migrate
npm run db:seed
npx tsx tests/e2e/fixtures/extra-videos.ts

# Production build+start rather than `next dev`: avoids per-route Turbopack lazy-compile lag on
# the first hit to each API route (10s+ per route, seen under dev), which just inflates the
# suite's real-wall-clock timing tests for no benefit.
npm run build
exec npx next start -p "${PORT:-3100}"
