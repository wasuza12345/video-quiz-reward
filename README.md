# ดูคลิป รับแต้ม — Mini Interactive Video Quiz & Reward

Watch a YouTube clip to the end, answer the quiz that pops up mid-video, and earn points.
The **server** decides whether a video was really watched — the browser only reports events.

- **Live:** _Vercel URL — added after deploy_
- **Stack:** Next.js 16 (App Router) · TypeScript · Prisma 7 + SQLite (local) / Turso libSQL (prod) · Vitest · Playwright

## Documents

| Document | What it covers |
|---|---|
| [docs/plan/plan.md](docs/plan/plan.md) | Full plan: folder layout, schema, API contract, state machine, anti-cheat rules, phases, decisions |
| [docs/plan/er.html](docs/plan/er.html) | ER diagram (11 models, interactive SVG — open in a browser) |
| [docs/plan/api-flow.html](docs/plan/api-flow.html) | Step-by-step client ↔ backend sequence: every API call from first visit to +50 points |
| [docs/plan/anti-cheat-sim.html](docs/plan/anti-cheat-sim.html) | Interactive simulator of the server's anti-skip rules (bank, quiz gate, end check) |
| [docs/design/spec.md](docs/design/spec.md) | UI/UX spec: screens, states, copy, responsive rules |
| [docs/design/reference-engonair.md](docs/design/reference-engonair.md) | Visual reference notes |
| [docs/plan/clean-code-review-2.md](docs/plan/clean-code-review-2.md) | Code-quality review and the refactor plan it drives |

## Quick start (local)

```bash
cp .env.example .env          # fill the two secrets (≥32 chars) and ADMIN_EMAIL / ADMIN_PASSWORD (≥12 chars)
npm ci
npm run db:migrate            # creates ./dev.db
npm run db:seed               # first admin + the brief video (X7K_Xlz3T1Y, quiz at 0:13)
npm run dev                   # http://localhost:3000 · admin at /admin
```

Locally the app always uses `./dev.db`. Turso is used only when `VERCEL=1` or `ALLOW_TURSO=1`.

## Architecture

```
src/
  app/                 Next.js routes only (pages + thin API route files)
  proxy.ts             anonymous signed cookie (vq_uid), admin guard
  backend/
    domain/            pure rules: session state machine, progress validator, resume + reward policy
    modules/<name>/    controller → service → repository (+ interface) per feature; request schemas (zod) in shared/contracts
    common/            auth, errors, http, validation, audit
  frontend/
    public/            viewer: pages, hooks (YouTube player, watch tracker, session writer), reducer state
    admin/             backoffice: videos, quiz editor, users, sessions timeline, dashboard
    shared/ui/         shared components
  shared/              constants + contracts used by both sides
prisma/                schema, migrations, seed
tests/unit · tests/api (Vitest)   tests/e2e API + browser (Playwright)
```

## Anti-cheat — how "watched to the end" is decided

The server keeps a timeline (`WatchEvent`) and a state machine per session:
`CREATED → PLAYING ⇄ PAUSED → QUIZ_PENDING → … → ENDED`.

1. **Server clock only.** Real watch time (`playedWallSec`) is measured from the server's own arrival times while the session is PLAYING (≤10 s credited per event). The client's timestamps are never trusted.
2. **Progress bank.** Forward progress is allowed only up to a bank that refills at 1.1× real time (starts at 3 s, max 10 s). A small overrun is rejected softly (`SPEED_EXCEEDED`, 3 of them flag the session); a jump > 10 s is `SEEK_FORWARD` and flags it at once. An explicit SEEK may go at most `furthestSec + 1.5 s`. Rejected events snap the player back. (`src/backend/domain/progress-validator.ts`, `session-state-machine.ts`)
3. **Quiz gate.** Position can't pass a question's trigger (0:13) until it is answered correctly on the server; the correct answer never leaves the server.
4. **End check.** `ENDED` is accepted only if every question is passed, the furthest point is within 2 s of the end, and real watch time ≥ 90 % of the video length.
5. **Exactly-once reward.** `PointsLedger` is unique per (user, video, reason); replays earn 0. Points are stored server-side, so they survive refresh.

The client adds a first line of defence: no seek bar, keyboard shortcuts disabled, playback rate locked to 1×, a click shield over the iframe, and a per-frame seek guard that snaps any jump past the watched point straight back (`src/frontend/public/hooks/watch-tracker-core.ts`). Those are convenience only — the server rules above hold even against a modified client.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/videos` | published videos + featured |
| GET | `/api/me` | total points, rewarded videos |
| POST | `/api/sessions` | create or resume a watch session (returns quizzes without answers) |
| POST | `/api/sessions/:id/events` | batched PLAY / PAUSE / TICK / SEEK / TAB_HIDDEN / ENDED |
| POST | `/api/sessions/:id/answer` | answer the open question |
| POST | `/api/sessions/:id/claim` | claim points after ENDED |
| — | `/api/admin/*` | backoffice (login, videos, questions, users, sessions, stats) |

Request/response shapes and error codes: [plan.md §4](docs/plan/plan.md).

## Tests

```bash
npm run lint && npm run typecheck
npm run db:migrate            # the API tests need the local SQLite DB
npm test                      # unit + API integration (Vitest, local SQLite)
npm run test:e2e              # API + browser E2E (Playwright, isolated ./e2e.db)
```

CI (`.github/workflows/ci.yml`) runs on every push: lint → typecheck → `prisma validate` → migrate → seed twice (idempotency) → unit + API tests → build, on a throwaway SQLite file. Playwright E2E runs locally, not in CI. Tests never touch Turso.

## Deploy (Vercel)

Env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (from the Turso Marketplace integration), `ADMIN_SESSION_SECRET`, `USER_COOKIE_SECRET`; for seeding the first admin also `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Migrations: `scripts/db-deploy.sh` (run locally only with `ALLOW_TURSO=1`).
