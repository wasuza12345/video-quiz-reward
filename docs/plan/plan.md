# Plan — Mini Interactive Video Quiz & Reward

Status: v5.2 (planner, updated 2026-09-25) — built through P7 (main), human local check in progress; P8 deploy pending. Human decisions so far:
structure = Option A · DB = SQLite + Prisma · server timeline + state machine · backoffice ·
D4 = admin table + bcrypt + signed cookie · D5 = `/` list (featured brief video) → `/watch/[videoId]` ·
APP_NAME = "ดูคลิป รับแต้ม" · design ref = engonair.com, font LINE Seed Sans TH (OFL 1.1, self-host), **no EngOnAir logo**, copy voice = ครูหวาน ("ค่ะ/นะคะ").
D1–D3 closed (§11): Turso · signed anonymous cookie · resume paused.

Changelog:
- v5.1 — reviewer round 3 (0 BLOCKER, 1 MAJOR, 7 MINOR): 409 recovery never resends stale seqs; keepalive only when idle;
  credit-then-check order; batch abort after first rejected progress; gate/ENDED fallbacks; `passedQuestionIds` in the CAS'd row;
  `softRejectCount`; bank cap 6 s; stale text fixed.
- v5 — reviewer round 2 (1 BLOCKER, 4 MAJOR, 6 MINOR): quiz gate sends TICK before PAUSE; token bucket
  (`bankSec`) replaces cumulative budget; CAS on `version` + update-then-insert + `@@unique([sessionId, seq])`;
  proxy matcher covers public paths; client resync after rejected progress; keepalive PAUSE; throttle/seed hardening.
- v4 — reviewer round 1 (1 BLOCKER, 6 MAJOR, 13 MINOR) applied: cumulative play-time budget (`playedWallSec`),
  benign no-op transitions, single in-flight write + CAS, explicit resume rules, `playsinline`, Turso migrate/seed
  step, position rules; cut `WatchSegment`/coverage, `order`, `rewardedAt`, seq on answer/claim; cookie/admin hardening.
- v3 — multi-video, backoffice, admin auth, timeline + state machine. v2 — layered folders, Prisma. v1 — first draft.

## 0. Facts verified
- Brief video `X7K_Xlz3T1Y`: embeddable (oEmbed OK), **44 s** (`"lengthSeconds":"44"`).
- "วินาทีที่ 0.13" = **0:13 = 13 s**.
- YouTube needs the **IFrame Player API** (no `<video>`, no `timeupdate`) → poll `getCurrentTime()` via `requestAnimationFrame`.
- Vercel has no persistent disk → prod SQLite = **Turso (libSQL)** via `@prisma/adapter-libsql`
  (Marketplace `tursocloud/database`). Dev/test: local SQLite file, same schema and code.
- LINE Seed Sans TH: SIL Open Font License 1.1 (seed.line.me) → self-host allowed; fallback Noto Sans Thai.
  Human rule: if the licence ever does not allow our use, switch to Noto Sans Thai (OFL) entirely.
- Design tokens/components: `docs/design/reference-engonair.md` (designer).

## 1. Pages
| Area | Route | Purpose |
|---|---|---|
| Public | `/` | **featured card = brief video on top** (`Video.isFeatured`), then list (grid on desktop); total points |
| Public | `/watch/[videoId]` | player + pop-up quizzes + reward (the brief's page) |
| Admin | `/admin/login` | sign in |
| Admin | `/admin` | dashboard: views, completions, points awarded, flagged sessions |
| Admin | `/admin/videos`, `/new`, `/[id]` | CRUD, preview, publish/archive, set featured, quiz editor |
| Admin | `/admin/users`, `/[id]` | points + session history |
| Admin | `/admin/sessions`, `/[id]` | list (filter flagged) + **timeline** of events |

## 2. Folder structure
```
video-quiz-reward/
├─ prisma/  schema.prisma · migrations/ · seed.ts         # first admin (env) + brief video & quiz (featured)
├─ scripts/ db-deploy.sh                                   # apply migrations to Turso (§9)
├─ public/fonts/                                           # LINE Seed Sans TH (self-hosted)
├─ src/
│  ├─ proxy.ts                        # matcher: /, /watch/:path*, /api/:path*, /admin/:path* — issues vq_uid · guards admin
│  ├─ app/                            # routing only — thin
│  │  ├─ (public)/page.tsx · (public)/watch/[videoId]/page.tsx
│  │  ├─ admin/(auth)/login/page.tsx
│  │  ├─ admin/(panel)/layout.tsx · page.tsx · videos/… · users/… · sessions/…
│  │  └─ api/
│  │     ├─ me/ · videos/ · sessions/ · sessions/[id]/{events,answer,claim}/   # public
│  │     └─ admin/{auth,videos,questions,users,sessions,stats}/…              # admin
│  ├─ frontend/
│  │  ├─ public/
│  │  │  ├─ pages/       VideoListPage.tsx · WatchPage.tsx
│  │  │  ├─ components/  FeaturedVideoCard · VideoCard · VideoPlayer · QuizModal · RewardCard · PointsBadge · ControlBar + LiveControlBar · WatchProgress
│  │  │  ├─ hooks/       useYouTubePlayer · useWatchTracker + watch-tracker-core · useSessionWriter + session-writer-core (seq + single in-flight queue) · usePlayerProgress
│  │  │  ├─ state/       watch.reducer.ts · watch.actions.ts · watch.selectors.ts
│  │  │  └─ services/ · types/ · constants/
│  │  ├─ admin/          pages/ · components/ (VideoForm · YouTubePreview · QuizEditor · SessionTimeline · StatTiles) · services/
│  │  └─ shared/ui/      Button · Modal · Badge · Table · form fields (EngOnAir tokens)
│  ├─ backend/
│  │  ├─ modules/        # each: *.controller · *.service · *.repository · *.interface (zod request schemas live in shared/contracts)
│  │  │  ├─ user/  video/  quiz/  watch-session/  reward/  admin-auth/  analytics/
│  │  ├─ domain/         # pure, no IO — unit tested
│  │  │  ├─ session-state-machine.ts   # transition table (§5)
│  │  │  ├─ progress-validator.ts      # budget + seek rules (§6)
│  │  │  ├─ resume-policy.ts           # which session to resume (§4.3)
│  │  │  └─ reward-policy.ts           # canEnd()
│  │  ├─ common/
│  │  │  ├─ errors/  app-error.ts · error-codes.ts
│  │  │  ├─ http/    handler.ts · response.ts · body-limit.ts
│  │  │  ├─ auth/    user-cookie.ts (sign/verify vq_uid) · admin-session.ts · require-admin.ts · origin-check.ts · login-throttle.ts
│  │  │  └─ validation/validate.ts
│  │  ├─ lib/        prisma.ts (singleton + libsql adapter) · password.ts (bcryptjs) · youtube.ts
│  │  ├─ config/env.ts                # validated env; secrets ≥ 32 bytes
│  │  └─ container.ts                 # wiring (plain factory functions, no DI library)
│  └─ shared/  contracts/ (zod + types) · constants/ (states, event types, reasons, tolerances)
├─ tests/  unit/ · api/ · e2e/ (public mobile+desktop, admin desktop)
├─ docs/   plan/ · design/
├─ .github/workflows/ci.yml           # lint · typecheck · prisma validate · migrate · seed×2 · unit · api · build (Playwright E2E runs locally, not in CI)
└─ .env.example
```

### Layers (request flows top → bottom)
| Layer | File | Does | Must not |
|---|---|---|---|
| Proxy | `src/proxy.ts` | issue `vq_uid` on public paths; reject unauthenticated admin requests early | be the only admin check |
| Route | `app/api/**/route.ts` | one line: delegate to controller | contain logic |
| Controller | `*.controller.ts` | identity / `requireAdmin()`, body limit, validate schema, call service, shape response | touch Prisma |
| Schema | `shared/contracts` | zod input/output | — |
| Service | `*.service.ts` | business steps; compute in memory, then persist in one batch write | know Request/Response or Prisma |
| Domain | `backend/domain/*` | pure rules | any IO |
| Interface | `*.interface.ts` | repository contracts + entity types | — |
| Repository | `*.repository.ts` | the only place with Prisma queries | business rules |

Import rules: route → controller → service → (domain, repository interface) → repository → `lib/prisma`.
`frontend/` never imports `backend/`; both import only `shared/`. `frontend/public` never imports `frontend/admin`.

## 3. Database — `prisma/schema.prisma` (ER diagram: `docs/plan/er.html`)
```prisma
datasource db {
  provider = "sqlite"
}

// ---------- admin ----------
model Admin {
  id           String          @id @default(uuid())
  email        String          @unique
  passwordHash String                                      // bcrypt
  tokenVersion Int             @default(0)                 // bump on logout-all / password change → old JWTs invalid
  createdAt    DateTime        @default(now())
  auditLogs    AdminAuditLog[]
}

model LoginThrottle {                                      // two rows per attempt: "ip:<sha(email|ip)>" and "email:<sha(email)>"
  key         String    @id
  failCount   Int       @default(0)                        // atomic { increment: 1 }
  windowStart DateTime  @default(now())                    // email key: 50 fails / hour → 429
  lockedUntil DateTime?                                    // ip key: 5 fails → 15 min
  updatedAt   DateTime  @updatedAt
}

model AdminAuditLog {                                      // optional in P5 (cut if time is short)
  id        Int      @id @default(autoincrement())
  adminId   String
  admin     Admin    @relation(fields: [adminId], references: [id])
  action    String                                         // video.create | video.publish | question.update …
  entity    String
  entityId  String
  diff      String?                                        // JSON text
  createdAt DateTime @default(now())
  @@index([entity, entityId])
}

// ---------- content ----------
model User {
  id        String         @id                             // UUID inside the signed vq_uid cookie
  createdAt DateTime       @default(now())
  sessions  WatchSession[]
  points    PointsLedger[]
}

model Video {
  id           String         @id @default(uuid())
  youtubeId    String         @unique
  title        String
  channelName  String                                      // oEmbed author_name, shown as "วิดีโอจาก YouTube: {channelName}"
  durationSec  Float                                       // server truth
  rewardPoints Int            @default(50)
  status       String         @default("draft")            // draft | published | archived
  isFeatured   Boolean        @default(false)              // at most one true (enforced in service)
  publishedAt  DateTime?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  questions    QuizQuestion[]
  sessions     WatchSession[]
  points       PointsLedger[]
  @@index([status])
}

model QuizQuestion {                                       // order = ascending triggerSec
  id            String        @id @default(uuid())
  videoId       String
  video         Video         @relation(fields: [videoId], references: [id])
  triggerSec    Float
  prompt        String
  correctChoice String                                     // never sent to the public client
  choices       QuizChoice[]
  attempts      QuizAttempt[]
  @@unique([videoId, triggerSec])
}

model QuizChoice {
  questionId String
  question   QuizQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  label      String                                        // "A".."D"
  text       String
  @@id([questionId, label])
}

// ---------- watching ----------
model WatchSession {
  id                String        @id @default(uuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id])
  videoId           String
  video             Video         @relation(fields: [videoId], references: [id])
  isReplay          Boolean       @default(false)          // created after the video was already rewarded
  state             String        @default("CREATED")     // §5
  currentQuestionId String?                                // set while QUIZ_PENDING
  passedQuestionIds String        @default("[]")          // JSON array — inside the CAS'd row (QuizAttempt is audit only)
  positionSec       Float         @default(0)             // last accepted position (TICK / SEEK back only)
  furthestSec       Float         @default(0)             // max accepted TICK position; watched = [0, furthestSec]
  playedWallSec     Float         @default(0)             // server wall time spent in PLAYING (canEnd only)
  bankSec           Float         @default(3)             // token bucket for progress past furthestSec (§6), max 10
  lastPlayingAt     DateTime?                             // serverAt when PLAYING credit was last taken; null if not PLAYING
  lastSeq           Int           @default(0)             // highest client seq accepted
  version           Int           @default(0)             // CAS guard, bumped by EVERY session write (§4.2)
  eventCount        Int           @default(0)             // abuse cap
  softRejectCount   Int           @default(0)             // SPEED_EXCEEDED + NOT_WATCHED; flag at ≥ 3 (§5)
  flagged           Boolean       @default(false)
  startedAt         DateTime      @default(now())
  endedAt           DateTime?
  events            WatchEvent[]
  attempts          QuizAttempt[]
  reward            PointsLedger?
  @@index([userId, videoId, startedAt])
  @@index([videoId, flagged])
}

model WatchEvent {                                         // append-only timeline (audit, backoffice view)
  id           Int          @id @default(autoincrement())
  sessionId    String
  session      WatchSession @relation(fields: [sessionId], references: [id])
  seq          Int?                                        // client counter ≥ 1; NULL for server rows (RESUME, ANSWER, CLAIM)
  type         String                                      // PLAY | PAUSE | TICK | SEEK | TAB_HIDDEN | ENDED | ANSWER | CLAIM | RESUME
  positionSec  Float
  clientAt     DateTime?                                   // display only
  serverAt     DateTime     @default(now())
  accepted     Boolean
  rejectReason String?
  fromState    String
  toState      String
  payload      String?                                     // JSON, e.g. {"questionId":"…","choice":"B"}
  @@unique([sessionId, seq])                               // SQLite allows many NULLs → server rows OK
  @@index([sessionId, serverAt])
}

model QuizAttempt {
  id         Int          @id @default(autoincrement())
  sessionId  String
  session    WatchSession @relation(fields: [sessionId], references: [id])
  questionId String
  question   QuizQuestion @relation(fields: [questionId], references: [id])
  choice     String
  isCorrect  Boolean
  createdAt  DateTime     @default(now())
  @@index([sessionId, questionId])
}

model PointsLedger {
  id        Int          @id @default(autoincrement())
  userId    String
  user      User         @relation(fields: [userId], references: [id])
  videoId   String
  video     Video        @relation(fields: [videoId], references: [id])
  sessionId String       @unique
  session   WatchSession @relation(fields: [sessionId], references: [id])
  points    Int
  reason    String                                         // "video_completed"
  createdAt DateTime     @default(now())
  @@unique([userId, videoId, reason])                      // once per user per video, race-safe
}
```
- String "enums" are validated by zod constants in `shared/constants`.
- Rewarded = a `PointsLedger` row exists for the session (no `rewardedAt` column).
- `WatchEvent` is an audit timeline. The session row is the authoritative state; no "rebuild by replay" promise.
- Claim: `create` the ledger row **outside** any interactive `$transaction`; catch Prisma `P2002` → `{ awarded:false }`.
- Coder: pin the Prisma version at P1 and follow **that version's** docs for the libsql adapter/config.

## 4. API contract
All JSON. Errors: `{ error: { code, message, ...extra } }`. Bad body → 400 `VALIDATION_ERROR`; body > 16 KB → 413.

### 4.1 Public (cookie `vq_uid` = signed UUID, httpOnly, Secure, SameSite=Lax, Max-Age 1 year, issued in `proxy.ts`;
`User` row is upserted on the first write — POST `/api/sessions`; GET `/api/me` for an unknown id returns 0 points)
| Method + path | Body | 200 response | Errors |
|---|---|---|---|
| GET `/api/me` | – | `{ totalPoints, rewardedVideoIds }` | – |
| GET `/api/videos` | – | `{ featured: Video \| null, videos: [{ id, youtubeId, title, channelName, durationSec, rewardPoints, rewarded }] }` (published only) | – |
| POST `/api/sessions` | `{ videoId }` | `{ sessionId, state, positionSec, furthestSec, lastSeq, isReplay, alreadyRewarded, currentQuestionId, passedQuestionIds, video:{ id, youtubeId, title, channelName, durationSec, rewardPoints }, quizzes:[{ id, triggerSec, prompt, choices:[{label,text}] }] }` | 404 VIDEO_NOT_FOUND (missing / not published) |
| POST `/api/sessions/:id/events` | `{ events:[{ seq (≥1), type, positionSec, clientAt }] }` (1–20; PLAY/PAUSE/TICK/SEEK/TAB_HIDDEN/ENDED) | `{ state, positionSec, furthestSec, lastSeq, currentQuestionId, results:[{ seq, accepted, rejectReason }] }` | 403 NOT_OWNER · 409 SEQ_CONFLICT `{lastSeq,state,positionSec,furthestSec}` · 429 EVENT_LIMIT |
| POST `/api/sessions/:id/answer` | `{ questionId, choice }` | `{ correct, state }` | 400 INVALID_CHOICE · 403 NOT_OWNER · 409 NOT_AT_QUIZ |
| POST `/api/sessions/:id/claim` | – | `{ awarded, points, totalPoints }` | 403 NOT_OWNER · 422 NOT_ENDED |

### 4.2 Writes and ordering
- **Client:** one write in flight per session (events, answer, claim share one queue in `useSessionWriter`).
  PLAY / PAUSE / TAB_HIDDEN / ENDED / SEEK are sent immediately (flushing queued TICKs first);
  TICKs are produced every 1 s and flushed every 5 s.
  On `visibilitychange: hidden` the client pauses the video and, **only if no write is in flight**, sends TAB_HIDDEN
  with `fetch(…, { keepalive: true })`. Otherwise it relies on the 10 s credit cap and RESUME (§4.3) — a missing PAUSE is safe.
- **409 recovery (never loops):** on 409 SEQ_CONFLICT the client (1) drops every queued event with `seq ≤ server lastSeq`
  and all stale TICKs, (2) sets `nextSeq = max(localSeq, server lastSeq) + 1`, (3) adopts server `state`, `positionSec`,
  `furthestSec` and calls `seekTo(positionSec)`, (4) resends only the current player-state event (PLAY or PAUSE) if it
  differs from the server state. Stale seqs are never resent. After rejected progress (200 with rejected results) the
  client does (3) as well.
- **seq:** client seq ≥ 1 (zod), strictly increasing per session, gaps allowed. `seq ≤ lastSeq`: if the stored event
  with that seq (`@@unique([sessionId, seq])`) has the same `type` + `positionSec` → return its stored result
  (idempotent retry); otherwise 409 SEQ_CONFLICT.
- **Server (every session write — events, answer, claim, resume):** read session (incl. `version`) → run domain in memory →
  1) `updateMany({ where: { id, version: v }, data: { ...changes, version: v + 1 } })`;
  2) only if `count === 1` → `createMany(events)` (audit rows; a crash between 1 and 2 loses audit rows only, never state).
  `count === 0` → 409 SEQ_CONFLICT with current `{lastSeq, state, positionSec, furthestSec}`; client resyncs and retries.
- A rejected event never fails the batch: it is stored `accepted=false` and reported in `results`.
- Caps: ≤ 20 events per request, ≤ 2000 events per session (429), body ≤ 16 KB.

### 4.3 Resume rules (`resume-policy.ts`, POST `/api/sessions`)
1. Never resume a session that has a ledger row (rewarded).
2. If the video is **not yet rewarded** for this user: resume the newest session (any state incl. ENDED → client auto-claims);
   if none, create one (`isReplay=false`).
3. If the video **is rewarded**: resume the newest `isReplay` session unless it is ENDED; otherwise create a new one with `isReplay=true`.
4. On resume, a PLAYING session becomes **PAUSED** and `lastPlayingAt = null` (server writes a `RESUME` event, seq NULL).
5. Archived video: sessions already started may continue and claim; new sessions → 404.
6. Accepted race: two tabs creating a session at the same moment may create two sessions; harmless (ledger unique).

### 4.4 Admin (cookie `vq_admin`; mutating calls incl. login pass `origin-check`)
| Method + path | Purpose |
|---|---|
| POST `/api/admin/auth/login` `{ email, password }` · POST `/logout` · GET `/me` | 401 INVALID_CREDENTIALS · 429 TOO_MANY_ATTEMPTS |
| GET/POST `/api/admin/videos` · GET/PATCH `/api/admin/videos/:id` | create takes `{ youtubeUrl, title?, durationSec, rewardPoints }` |
| POST `/api/admin/videos/:id/{publish,archive,feature}` | status / featured (feature unsets the others) |
| POST `/api/admin/videos/:id/questions` · PATCH/DELETE `/api/admin/questions/:id` | quiz CRUD incl. choices |
| GET `/api/admin/users[/:id]` · `/api/admin/sessions[?videoId&flagged]` · `/api/admin/sessions/:id` · `/api/admin/stats` | read-only |
Errors: 401 UNAUTHENTICATED · 403 BAD_ORIGIN · 409 VIDEO_LOCKED · 409 DUPLICATE_TRIGGER · 422 INVALID_TRIGGER.

### 4.5 Response shapes closed for the design spec (spec §9, 2026-09-24)
- GET `/api/videos` items also carry `questionCount`.
- Admin video (list item + detail): `{ id, youtubeId, title, channelName, durationSec, rewardPoints, status, isFeatured,
  publishedAt, questionCount, sessionCount, locked }` (`locked = sessionCount > 0`); detail adds `questions:[{ id, triggerSec, prompt,
  correctChoice, choices:[{label,text}] }]`.
- `rewardPoints`: integer 1–1000. Once locked, adding/removing a **choice** is locked too (labels drive `correctChoice`); text stays editable.
- Duplicate `triggerSec` → 409 `DUPLICATE_TRIGGER`. Publishing a video with 0 questions is allowed (UI shows a warning).
- GET `/api/admin/stats?videoId` → `{ views, completions, pointsAwarded, flaggedSessions }`
  (views = non-replay sessions, completions = ledger rows, pointsAwarded = Σ ledger points).
- Paging for admin lists: `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }`.
- GET `/api/admin/users` items: `{ id, createdAt, totalPoints, sessionCount, lastActiveAt }`;
  `/api/admin/users/:id` → `{ user:{ id, createdAt, totalPoints }, ledger:[{ sessionId, videoId, videoTitle, points, createdAt }], sessions:[SessionRow] }`.
- GET `/api/admin/sessions?videoId&flagged&page&pageSize` items = SessionRow:
  `{ id, userId, videoId, videoTitle, state, flagged, isReplay, furthestSec, durationSec, playedWallSec, pointsAwarded, startedAt, endedAt }`.
- GET `/api/admin/sessions/:id` → `{ session: SessionRow + { positionSec, bankSec, softRejectCount, passedQuestionIds,
  currentQuestionId, questionCount, lastSeq, version, eventCount }, events:[{ id, seq, type, positionSec, clientAt, serverAt, accepted,
  rejectReason, fromState, toState, payload }] }` ordered by `serverAt, id` (≤ 2000 by cap, no paging).

## 5. Server state machine (`backend/domain/session-state-machine.ts`)
States: `CREATED · PLAYING · PAUSED · QUIZ_PENDING · ENDED` (rewarded = ledger row exists).

| From | Event | To | Rule |
|---|---|---|---|
| CREATED / PAUSED | PLAY | PLAYING | `lastPlayingAt = serverAt` |
| PLAYING | PLAY | PLAYING | no-op (accepted, not flagged) |
| PLAYING | PAUSE / TAB_HIDDEN | PAUSED | credit play time (§6), `lastPlayingAt = null` |
| PAUSED / CREATED | PAUSE / TAB_HIDDEN | same | no-op |
| PLAYING | TICK | PLAYING | §6 progress rules |
| PLAYING | TICK at/after next unpassed `triggerSec` | QUIZ_PENDING | accepted, position clamped to `triggerSec`, `currentQuestionId` set, play time credited, `lastPlayingAt = null` |
| PAUSED / CREATED | TICK | same | recorded only (race with pause), no position change |
| QUIZ_PENDING | PLAY / PAUSE / TAB_HIDDEN | QUIZ_PENDING | no-op |
| QUIZ_PENDING | TICK | QUIZ_PENDING | rejected `QUIZ_REQUIRED` (not flagged) |
| QUIZ_PENDING | ANSWER correct (`questionId == currentQuestionId`) | PAUSED | append to `passedQuestionIds` (same CAS write); client then sends PLAY |
| QUIZ_PENDING | ANSWER wrong | QUIZ_PENDING | attempt stored |
| PLAYING / PAUSED | SEEK to `pos < positionSec` | same | `positionSec = pos` (furthest unchanged) |
| PLAYING / PAUSED | SEEK to `pos ≥ positionSec` | same | ≤ `furthestSec`: accept · (`furthestSec`, `furthestSec + 1.5`]: accept, clamp to `furthestSec` · above: rejected `SEEK_FORWARD` (flagged) |
| PLAYING / PAUSED | ENDED | ENDED | `reward-policy.canEnd` else rejected `NOT_WATCHED` (`softRejectCount += 1`) |
| ENDED | CLAIM | ENDED | not replay & not rewarded → ledger +points; replay → `awarded:false` (not flagged) |
| any | anything else | same | rejected `INVALID_TRANSITION` (not flagged) |

Position rules: only TICK and SEEK change `positionSec`; only TICK raises `furthestSec`; PLAY/PAUSE/TAB_HIDDEN/ENDED only record their position.
Batch rule: after the first rejected progress event (TICK/SEEK) in a request, the remaining progress events of that
request are rejected with `BATCH_ABORTED` (not flagged, no position change); non-progress events are still processed.
`flagged` is set by `SEEK_FORWARD` (first rejected event of a batch only), or when `softRejectCount ≥ 3`
(`SPEED_EXCEEDED` and `NOT_WATCHED` each add 1 — a single one can be network loss).

## 6. Anti-cheat
**Client (smooth UX):** playerVars `controls:0, disablekb:1, fs:0, playsinline:1, rel:0, iv_load_policy:3, modestbranding:1`.
Custom Play/Pause; PLAY/PAUSE events come from `onStateChange` (a tap on the iframe also toggles on mobile).
`onPlaybackRateChange` → `setPlaybackRate(1)`. rAF loop (`watch-tracker-core.ts`): compares against a LOCAL high-water mark (advances ≤ max(0.25 s, 2×frame time) per frame; a real pause/resume lifts it via `noteSettled`, ≤ 1.5 s); `current > mark + 1.5` → `seekTo(mark)`. Server rejections/409 `reconcile` the mark down.
**Quiz gate (order matters):** at `current ≥ next triggerSec` the client `pauseVideo()`, opens the modal, and **enqueues a
TICK at `current` before the PAUSE** (flushed immediately). The server moves to QUIZ_PENDING on that TICK; the PAUSE is
then a no-op. The answer is sent only after the write response shows `state = QUIZ_PENDING`. If the response state is
anything else (e.g. `SPEED_EXCEEDED` after a stall), the client closes the modal, resyncs, `seekTo(positionSec)` and continues.
**ENDED fallback:** on `NOT_WATCHED` the client shows "ดูต่ออีกนิดนะคะ", seeks to
`max(0, furthestSec − (0.9 × durationSec − playedWallSec))` and keeps playing.

**Server (the real guard) — `progress-validator.ts`:**
Per event, in this order (P2 tests pin it): **(1) credit → (2) gate clamp → (3) bucket check → (4) gate transition.**
1. **Play-time credit** — for every accepted event whose `fromState == PLAYING` (incl. PAUSE, TAB_HIDDEN and the TICK that
   enters QUIZ_PENDING): `Δ = min(serverAt − lastPlayingAt, 10)`; `playedWallSec += Δ`;
   `bankSec = min(bankSec + Δ × 1.1, 10)`; then `lastPlayingAt = serverAt` (or `null` when leaving PLAYING).
   RESUME never credits. Events in one batch share `serverAt`, so a batch adds no extra credit.
2. **Token bucket (fixes fast-forward / playbackRate / forged batches / banking by rewatch or idle):**
   a TICK to `pos > furthestSec` needs `need = pos − furthestSec`:
   `need ≤ bankSec` → accept, `bankSec −= need` (absorbs honest jank, e.g. a 1.6 s TICK gap on a busy phone);
   `need > 10` (larger than the bank can ever hold) → `SEEK_FORWARD` (flagged); otherwise → `SPEED_EXCEEDED` (soft).
   The +1.5 s slack applies to explicit **SEEK** events only (§5). A 2× player drains the bank in ≈7 s, then collects
   soft rejects → flagged at 3. (v5.2, planner decision after P2 heads-up.)
   At the quiz gate the cost is `min(pos, triggerSec) − furthestSec` (clamped position).
   Positions must be finite and within `[0, durationSec + 5]` (zod in P3 + assert in the domain).
   Client sends positions **unrounded** (or floored) and uses the same `≥ triggerSec` comparison as the server; the reducer
   opens the quiz whenever the server state is QUIZ_PENDING. A TICK in PAUSED/CREATED is `accepted` but does not move position.
   Positions ≤ `furthestSec` (rewatching) are accepted and cost nothing. The bank starts at 3 s and never exceeds 10 s
   (6 s was too tight under mobile arrival jitter — P2 review MINOR 1), so rewatching or idling can pre-pay at most 10 s of skip.
3. **Quiz gate:** a TICK past the next unpassed `triggerSec` is clamped to it and moves to QUIZ_PENDING.
4. **canEnd:** every question id in `passedQuestionIds` AND `furthestSec ≥ durationSec − 2` AND `playedWallSec ≥ durationSec × 0.9`.
   (No `startedAt` check — play time is measured, not session age.)

Result: to earn points, the server must observe ≈ 0.9 × duration of real PLAYING time, and new ground is never covered
faster than 1.1× beyond a ≤ 10 s bank.
**Accepted limits:** (a) a script that sends events at 1× real time is indistinguishable from a viewer — it still has to wait
the full video; (b) a single forward skip of ≤ 10 s (the bank) is tolerated; canEnd still needs 0.9 × duration of PLAYING time.

## 7. Backoffice rules
- **Admin session:** `vq_admin` = JWT (`jose`, HS256, `ADMIN_SESSION_SECRET` ≥ 32 bytes) with `{ adminId, tokenVersion }`, 8 h,
  httpOnly, Secure, SameSite=Strict. `requireAdmin()` verifies JWT **and** `tokenVersion` against DB. Logout bumps `tokenVersion`.
- **Proxy (admin branch):** the single matcher in §2 also covers public paths; inside the proxy, the admin guard applies to
  `/admin/:path*` and `/api/admin/:path*` except `/admin/login` and `/api/admin/auth/login` (route groups like `(panel)` are not in the URL).
- **Login throttle:** `LoginThrottle` per (email, ip): 5 fails → 15 min; plus per email: 50 fails / hour → 429 (stops IP rotation).
  Atomic increments; unknown email runs a dummy bcrypt compare. Client IP from Vercel's `x-real-ip` (`ipAddress()`),
  never the leftmost `X-Forwarded-For`. Seed rejects `ADMIN_PASSWORD` shorter than 12 characters.
- **Origin check:** `Origin` host must equal the request `Host` (works on Vercel preview URLs); applied to all mutating admin calls incl. login.
- **Known device (P5a fix):** successful login sets `vq_admin_dev` (HMAC adminId.nonce, 90 d); a valid one skips only the per-email cap.
  **Accepted risk:** an admin on a NEW device can still be blocked by the 50/h per-email attack until the window passes.
  **Accepted risk (client):** a devtools-level call to `player.seekTo()` can trigger YouTube auto-play outside our UI guard; the server still rejects the jump (SEEK_FORWARD) and pays nothing — covered by `tests/e2e/browser/both-viewports/03-seek-cheat.spec.ts`. No client hardening planned. Same class: repeating pause → devtools seek +1.5 s → PAUSED can ratchet the client guard via `WatchTracker.noteSettled` (bounded per event, not cumulative); the server bank refills only while PLAYING, so it ends in SPEED_EXCEEDED/SEEK_FORWARD flags and no reward.
- **Seed:** first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env (never committed); brief video seeded as published + featured.
- **Create video:** admin pastes URL → server parses `youtubeId`, fetches oEmbed (title, `channelName` = author_name, embeddable);
  `durationSec` filled by the admin preview player's `getDuration()` (admin input trusted), must be > 0.
- **Question rules:** `0 < triggerSec < durationSec − 2`; 2–4 choices; `correctChoice` ∈ labels.
- **Lock:** once a video has any `WatchSession`: `youtubeId`, `durationSec`, `triggerSec`, `correctChoice`, add/delete question
  → 409 `VIDEO_LOCKED`. Text, title, `rewardPoints`, featured stay editable. No hard delete → archive.

## 8. Public UI state (`frontend/public/state/watch.reducer.ts`)
`loading → ready → playing ⇄ paused → quiz_open(q) → (wrong: quiz_open + error, wrong choice disabled) → paused → playing → ended → claiming → rewarded`
plus `error`; a replay is the same flow with the `isReplay` flag (quizzes shown, no points), not a separate status. The server `state` from every write response is the source of truth;
the reducer reconciles to it: 409 or rejected progress → adopt server `positionSec`/`furthestSec` and `seekTo(positionSec)`
(honest users on a flaky network recover instead of drifting into SEEK_FORWARD). Only `WatchPage` holds the reducer. Copy tone: ครูหวาน ("ค่ะ/นะคะ").

## 9. Deploy (Turso) — proven in P1, not discovered in P8
- Migrations: P1 checks whether the pinned Prisma `migrate deploy` works against libsql. If not:
  `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` (and per-migration diffs) → apply with
  `turso db shell <db> < file.sql` via `scripts/db-deploy.sh`.
- Seed prod once, secrets from a git-ignored env file (never inline in shell history):
  `vercel env pull .env.production.local` → `node --env-file=.env.production.local --import tsx prisma/seed.ts` (idempotent upserts).
- Put the Turso DB in the same region as the Vercel functions; services avoid interactive transactions (batch writes, §4.2).
- Env (provisioned 2026-09-24: Turso `video-quiz-reward-db` via Marketplace, Vercel project `wasucodes-projects/video-quiz-reward`):
  runtime uses `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` when set (Vercel injects both into Production/Preview/Development),
  otherwise local `DATABASE_URL=file:./dev.db`; plus `ADMIN_SESSION_SECRET`, `USER_COOKIE_SECRET` (+ seed-only `ADMIN_EMAIL/PASSWORD`).
- As built (P1, dc74df0): Prisma **7.10.0** pinned (8.x is RC) with `generator client { provider = "prisma-client", output = "../src/generated/prisma" }`;
  `migrate deploy` works on `file:` only, so Turso migrations run via `scripts/db-deploy.sh` → `scripts/db-deploy-libsql.mjs`
  (@libsql/client, one write batch per migration, tracked in `_db_deploy_migrations`; token never in argv).
- Local guard: the app uses Turso only when `VERCEL=1` (set by Vercel) or `ALLOW_TURSO=1` (deploy/seed scripts), so `npm run dev`
  with `.env.local` stays on the file DB.
- ⚠️ One Turso DB is shared by all Vercel environments → it is effectively **prod**. Migrations + seed may target it
  (pre-launch, empty); automated tests must **never** use Turso — local file DBs only.

## 10. Phases, owners, acceptance
| # | Phase | Owner | Acceptance |
|---|---|---|---|
| P0 | Design spec v2: `/` (featured + list, 0/1/n videos), watch, backoffice; EngOnAir tokens | designer | every state in §8 + every page in §1 |
| P1 | Scaffold Next.js + Prisma + folders + lint/tsc + CI + seed; **Turso migrate + seed proven on a dev Turso DB** | coder | CI green; `prisma validate`; API test against Turso dev DB passes |
| P2 | Domain: state machine, progress validator, resume policy, reward policy | coder | unit test for every row in §5, every rule in §6 (incl. credit→check→gate order, batch abort), every case in §4.3 |
| P3 | Public backend modules + API (CAS, caps, cookie) | coder | API tests for every public error code + concurrent claim + SEQ_CONFLICT |
| P4 | Public frontend (list, watch, tracker, session writer) | coder | reducer tests; manual play at 360 px incl. iOS Safari |
| P5 | Admin auth + backoffice backend + UI | coder | API tests: 401, throttle, BAD_ORIGIN, tokenVersion revoke, VIDEO_LOCKED |
| P6 | E2E: server state is QUIZ_PENDING before answer, quiz retry, rewatch-then-skip of 20 s → SPEED_EXCEEDED, 409 recovery does not loop, throttled network recovers, forward seek blocked, `setPlaybackRate(2)` earns nothing, forged batch rejected, direct claim rejected, +50 once (concurrent), refresh in each state resumes & keeps points, replay gives 0, admin create → publish → watch | tester | Playwright green, report with counts |
| P7 | Code review (correctness/security/requirements) + clean-code | reviewer, clean-code | 0 BLOCKER, 0 MAJOR |
| P8 | GitHub + Vercel + Turso env + smoke on real URL (phone + desktop) | coder (+ human for accounts) | `/` shows brief video → quiz → +50 → refresh keeps 50; admin login works |

### P6 must also cover proxy.ts (from P3 review)
1. First visit `/` → Set-Cookie `vq_uid` HttpOnly, Secure, SameSite=Lax, Max-Age≈31536000, Path=/.
2. First-ever request = POST `/api/sessions` without cookie → 200 in the same request.
3. Valid cookie → no re-issue. 4. Tampered signature → new id; old session's events → 403 NOT_OWNER.
5. Matcher: `/watch/x`, `/api/*` get the cookie; `/_next/static/*` does not. 6. Refresh on /watch keeps id, points, resume.
7. `/admin/*` placeholder test that P5a must flip to 401/redirect. 8. `Secure` on http://localhost: Chromium OK; WebKit needs https or skip.
- Event cap = `max(2000, ceil(durationSec × 3))` (long videos must stay finishable); `/answer` counts toward it.

### Backlog (clean-code trim APPROVED by human 2026-09-25 — see clean-code-review-2.md)
- clean-code structure review @aaa9f37 — verdict "trim lightly": 2 MAJOR (duplicate event type in watch-session.service.ts:12-17;
  draft→404 decided in service.ts:123 and resume-policy.ts:30) + 5 MINOR (user pass-through, Pick<VideoRow>, findOwned,
  VIDEO_STATUSES to shared/constants, INTERNAL_ERROR code). ~36→32 files, ~−60 lines, no behaviour change. Scheduled via clean-code-review-2.md (#2–#9).
  Note: the 2 MAJORs are ~7 lines, zero-risk — fold them in only if a later phase touches those files anyway (needs human OK).
- P7 test gap (reviewer MINOR on 27790d4): add a unit test that pins "seek guard still armed after 1.5 s" (arm → advance fake timers 3 s → spurious PLAYING → swallowed; fails on 98a30a7). Test-only, not scheduled.
- ✅ FIXED a1981fb — Replay-after-network-error dead player (reviewer, pre-existing on main): end → claim → Replay → POST /api/sessions fails → error screen → Retry → new session loads but Play does nothing until a full reload. Cause: the error phase returns <ErrorState> early (WatchPage.tsx:413), unmounting <VideoPlayer>; useYouTubePlayer only re-runs on [youtubeId,title], so `player` points at a detached iframe. Fix: keep VideoPlayer mounted in the error phase or key the player effect on the container. Scheduled after #12 (watch files owned by coder-2 until then).

## 11. Decisions (all closed 2026-09-24)
- **D1 prod DB:** Turso + Prisma libsql adapter (Vercel Marketplace `tursocloud/database`).
- **D2 identity:** anonymous signed cookie UUID (`vq_uid`), no login for learners.
- **D3 refresh mid-video:** resume from last accepted position, paused (§4.3 rule 4).
- Designer questions — answered: title + channelName in responses · wrong choice disabled · auto-claim on ENDED ·
  replay allowed with quizzes, no points · pause on tab hidden · "+50 Points" · font LINE Seed Sans TH (OFL; Noto Sans Thai
  if licence ever disallows) · no EngOnAir logo · voice ครูหวาน · empty channelName → hide the source line.
