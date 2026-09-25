# Clean-code review #2 — main @ e33f721

Reviewer: clean-code · 2026-09-25 · read-only (git archive / git show; nothing checked out or run).
Code was read at 85f71dd; e33f721 only adds docs (README.md, docs/plan/api-flow.html, docs/plan/anti-cheat-sim.html, plan.md +5 lines — verified with `git diff --stat 85f71dd e33f721`), so all code line numbers hold at e33f721.
Proof tier: 🟠 static. Every "check" below names the tests that must stay green; none were run for this review.
Standard: `.agent/rules/clean-code.md` (rules 1–10). Grading criteria referenced as G1–G5.

Summary verdict
- **Backend (G1):** the old trim list still applies. It has grown one new MAJOR: public response types now exist in `shared/contracts` **and** again in the backend services.
- **Frontend watch state (G2/G3):** this is where criterion 3 is at risk. Status is split across a reducer with 29 fields (5 of them write-only). WatchPage also has 3 refs, 2 backstop timers and a `useState`, and the YouTube quirks (autoplay-after-seek, stale `getCurrentTime`, `ENDED` unstick) are handled inline in WatchPage's `onStateChange` switch. The design isn't wrong, but it isn't *systematic* yet.
- **Hygiene/docs (G1):** the README (added in e33f721) is mostly accurate but has 5 factual gaps (C1a–e) and an empty Live link. `plan.md` is stale in 6 places. 52 source-comment lines across 23 files name planners, reviewers, review rounds or `MAJOR n`. Test names carry the same process history.

---

## A. Frontend watch state

### A.1 What is there now (evidence)
| Where | What | Problem |
|---|---|---|
| `state/watch.reducer.ts:25-63` | 29 flat fields: `status`, plus `quizPhase`, `feedback`, `pendingChoice`, `wrongChoiceLabels`, `claimError`, `claimResult`, `inlineNotice`, `pausedByTabHidden`, `showResumedBanner`, … | Orthogonal flags allow impossible combinations (e.g. `status:"playing"` + `quizPhase:"submitting"`), so every case has to re-guard. |
| `watch.reducer.ts:28,34,45,60` + `:305` | `reloadingInPlace`, `serverState`, `isNewSession`, `offline` are **written, never read**; `CLAIM_STARTED` is never dispatched (only a test uses it) | Dead state (rule 9). |
| `watch.selectors.ts:59` | `selectAriaBusy` is unused (WatchPage computes `isLoading` itself) | Dead code. |
| `WatchPage.tsx:110-187` | `autoResuming` useState, `suppressAutoplayAfterSeekRef`, `suppressAutoplayTimeoutRef`, `autoResumingTimeoutRef`, 4 arm/clear callbacks, an unmount-cleanup effect | YouTube-quirk workarounds live in the page. They are UI state (`autoResuming` disables Play) kept outside the reducer. |
| `WatchPage.tsx:190-243` | `onStateChange` switch on raw `YT_PLAYER_STATE` codes. It mixes quirk handling (swallow spurious PLAYING, ignore BUFFERING), tracker calls (`noteSettled`), reducer dispatches and server writes | Rule 2 (does four things) and rule 5 (decisions mixed with IO). It can't be unit-tested without rendering the whole page. |
| `WatchPage.tsx:46,87-93,237` | `playedWallSecRef` interval + `0.9 * durationSec` | `0.9` duplicates `TOLERANCES.MIN_PLAYED_RATIO` (rule 3). |
| `WatchPage.tsx:382-385` ≡ `:445-448` | Title + channel block duplicated for desktop/mobile | Rule 3 (markup). |
| `watch.selectors.ts:16-23` ≡ `backend/domain/progress-validator.ts:55` | `nextUnpassedQuestion` implemented twice | Rule 3: the quiz-gate rule is defined in two places. |
| `hooks/session-writer-core.ts:6-11` | `QueuedEvent` re-declares the zod `clientEventSchema` type | Rule 3. |
| `hooks/watch-tracker-core.ts:22` | `SEEK_GUARD_SLACK_SEC = 1.5` | Mirrors `TOLERANCES.FORWARD_SLACK_SEC`. Either import it, or add a comment explaining why the client value is deliberately separate. |
| `useWatchTracker` rAF + `usePlayerProgress` rAF | Two loops polling `getCurrentTime()` | **Keep.** The split is justified: display is isolated to `LiveControlBar` so the page doesn't re-render at 10 Hz. |

What is already good and should stay: `session-writer-core.ts` and `watch-tracker-core.ts` as pure classes with hook wrappers (unit-tested); a single writer lock (`runExclusive`); the server as the source of truth (`EVENTS_SYNCED`/`SEQ_CONFLICT` reconcile); `LiveControlBar` isolation.

### A.2 Target shape
```
frontend/public/
├ player/
│  ├ youtube-player-adapter.ts   # pure class, no React: wraps YTPlayer, OWNS all quirks
│  │    - autoplay-after-seek guard (arm on seekTo({resume:false}), one-shot, 5s backstop)
│  │    - BUFFERING/UNSTARTED ignored; CUED ignored
│  │    - stale getCurrentTime → emits settled position on PAUSED and first real PLAYING
│  │    - playback-rate lock (from useYouTubePlayer)
│  │    emits normalized events only:  onPlay(pos) · onPause(pos) · onEnded(pos)
│  │    commands:  play() · pause() · seekTo(sec, {resume}) · currentTime()
│  └ useYouTubePlayer.ts         # loads the IFrame API, constructs the adapter, lifecycle only
├ state/
│  ├ watch.machine.ts            # replaces watch.reducer.ts + watch.actions.ts
│  └ watch.selectors.ts
├ hooks/ useSessionWriter · session-writer-core · useWatchTracker · watch-tracker-core · usePlayerProgress (unchanged roles)
└ pages/WatchPage.tsx            # wiring + render only, no YT_PLAYER_STATE import, no timers of its own except
                                  # the ones driven by machine state (loading-slow, quiz auto-resume)
```

Machine state: one discriminated union for the phase, plus a separate server snapshot:
```ts
type Phase =
  | { kind: "loading"; slow: boolean }
  | { kind: "error"; error: WatchError }
  | { kind: "ready"; resumedAtSec: number | null }
  | { kind: "playing"; endedFallback: boolean }
  | { kind: "paused"; reason: "user" | "tab_hidden" }
  | { kind: "quiz"; questionId: string;
      step: "syncing" | "answering" | "submitting" | "correct" | "resuming";
      pendingChoice: string | null; wrongChoices: string[]; feedback: Feedback | null }
  | { kind: "ending" }                                   // ENDED sent, awaiting server
  | { kind: "claiming"; failed: boolean }
  | { kind: "rewarded"; result: ClaimResponse; replayEnd: boolean };

interface WatchState {
  phase: Phase;
  session: SessionSnapshot | null;   // id, positionSec, furthestSec, lastSeq, isReplay, alreadyRewarded, passedQuestionIds, video, quizzes
  points: { total: number | null; unavailable: boolean };
  seekRequest: { toSec: number; resume: boolean } | null;
  toast: ToastRequest | null;
  showReplayBanner: boolean;
}
```
Mapping (what merges or is deleted):
- `status` + `quizPhase` + `pendingChoice` + `wrongChoiceLabels` + `feedback` → `phase` (`quiz` variant).
- `claimError` + `claimResult` + `inlineNotice` → `phase.claiming.failed` / `phase.rewarded.replayEnd` / `phase.playing.endedFallback`.
- `pausedByTabHidden` → `phase.paused.reason`. `loadingSlow` → `phase.loading.slow`. `showResumedBanner` → `phase.ready.resumedAtSec`.
- **Delete:** `reloadingInPlace`, `serverState`, `isNewSession`, `offline`, `CLAIM_STARTED`, `selectAriaBusy`.
- `autoResuming` (useState) + its 3 s backstop → `quiz.step:"resuming"`. The machine leaves `resuming` on `PLAYER_PLAYING`, or on a `RESUME_TIMEOUT` action fired by one effect keyed on that step.
- `pendingSeekTo` → `seekRequest{toSec, resume}`. The adapter's `seekTo(sec,{resume})` arms/clears its own guard. **Delete from WatchPage:** `suppressAutoplayAfterSeekRef`, `suppressAutoplayTimeoutRef`, `armAutoplayGuard`, `clearAutoplayGuard`, the unmount-cleanup effect.
- `claimAttemptedRef` → unnecessary once `claiming` is only entered on a transition. The claim effect keys on `phase.kind === "claiming" && !phase.failed`.
- `playedWallSecRef` + interval: keep the estimate, but import `TOLERANCES.MIN_PLAYED_RATIO` instead of `0.9`. Move the seek-back formula into a pure selector/helper (`endedFallbackSeekSec(furthest, duration, playedWall)`) so it has a unit test.
- `nextUnpassedQuestion` → one generic pure function in `src/shared/rules/quiz-gate.ts`, imported by `backend/domain/progress-validator.ts` and `watch-tracker-core.ts`/selectors. The client/server gate rule then can't drift.

Expected size: WatchPage 468 → ~260 lines. Reducer 341 → ~260 (fewer defensive guards, because invalid combinations can't be represented). A new adapter of ~120 lines takes over the quirk logic that `watch-page-autoplay-guard.test.tsx` tests today, so that behavior can be tested directly against the adapter.

---

## B. Backend — old trim list re-checked @85f71dd

| # | Sev | Finding @85f71dd | Status vs @aaa9f37 |
|---|---|---|---|
| B1 | MAJOR | **Response types defined twice.** `shared/contracts/session.ts:33-93` + `contracts/video.ts` now define `PublicChoice`, `PublicQuestion`, `SessionResponseVideo`, `SessionCreateResponse`, `EventsApplyResponse`, `AnswerResponse`, `ClaimResponse`, `MeResponse`, `PublicVideoItem`, `VideoListResponse`. The backend re-declares them: `watch-session.service.ts:19-55` (`SessionResponseVideo`, `SessionCreateResult`, `EventsApplyResult` — with a looser `rejectReason: string`, `AnswerApplyResult`), `reward.service.ts:7` `ClaimResult`, `video.service.ts:9-23` `PublicVideoItem`/`VideoListResult`, `quiz.interface.ts:3-14` `PublicChoice`/`PublicQuestion`, `reward.interface.ts:1` `UserRewardSummary` (≡ `MeResponse`). | **New.** Replaces the old "Pick<VideoRow>" MINOR. |
| B2 | MAJOR | `watch-session.service.ts:12-17` `EventInputBody` ≡ `z.infer<clientEventSchema>` | Still open |
| B3 | MAJOR | `watch-session.service.ts:123` checks `status === "draft"`, which `domain/resume-policy.ts:31` also owns | Still open |
| B4 | MAJOR | `frontend/admin/lib/youtube.ts` `parseYoutubeIdClient` is a line-for-line copy of `backend/lib/youtube.ts:5-31` `parseYoutubeId` (its comment admits it's a mirror) | **New.** Fix: move the pure parser to `src/shared/youtube-id.ts`; both import it. |
| B5 | MAJOR | `frontend/admin/pages/AdminSessionDetailPage.tsx:21` `PLAYED_WALL_REQUIRED_RATIO = 0.9` duplicates `TOLERANCES.MIN_PLAYED_RATIO` | **New** |
| B6 | MINOR | `user/` module: `user.service.ts:9` only forwards to `rewardRepo.getUserSummary`; `user.repository` has one method (`ensure`) | Still open |
| B7 | MINOR | Ownership check is duplicated: `reward.service.ts:25` ≡ `watch-session.service.ts:96` | Still open |
| B8 | MINOR | `video.repository.ts:3` imports `VideoStatus` via `domain/resume-policy.ts:6` (re-export); `:25` casts blindly with `as VideoStatus` | Partly fixed (the type now lives in `shared/constants/video.ts`). Remaining: import from shared, drop the re-export, and parse with `VIDEO_STATUSES`. |
| B9 | MINOR | `handler.ts:9` `"INTERNAL_ERROR"` is not in `ERROR_CODES` | Still open |
| B10 | MINOR | `AdminQuestionRow` is declared in both `video.interface.ts:23` and `quiz.interface.ts:24` (the second adds `videoId`); `shared/contracts/admin.ts` has `AdminQuestionDetail` with the same shape | **New** |

Keep as is: `domain/*`, repositories as the only Prisma boundary, `common/*`, `container.ts`, controllers (the admin controllers now do real work: `requireAdmin`, origin-check, audit), `proxy.ts`.

---

## C. Repo hygiene for graders

| # | Sev | Finding |
|---|---|---|
| C1 | MAJOR (G5) | `README.md:6` Live link is a placeholder ("added after deploy"). This blocks G5 until P8. |
| C1a | MINOR | `README.md:40` says "controller → service → repository (+ schema, interfaces)", but no `*.schema.ts` exists; zod lives in `shared/contracts`. Say "(+ interface); request schemas in `shared/contracts`". |
| C1b | MINOR | `README.md:48` and `:82` omit `tests/api/`. `npm test` runs **unit + API integration** (`vitest.config.mts` include: `tests/unit/**`, `tests/api/**`), and the API tests need `db:migrate` first (`tests/setup.ts` demands `DATABASE_URL=file:`). Say "unit + API (Vitest, local SQLite; run db:migrate first)". |
| C1c | MINOR | `README.md:86` "CI runs lint, typecheck, unit tests and build". `ci.yml` also runs `prisma validate`, migrate, seed ×2 (idempotency) and the API tests, and does **not** run Playwright. List the steps exactly; graders read CI claims literally. |
| C1d | MINOR (G4) | The README anti-cheat section (`:51-62`) is accurate against the code: bank 1.1×/3 s/10 s, credit cap 10 s, `SEEK_FORWARD` flags, end check 2 s/90 %, and the ledger unique key all match `TOLERANCES`, `progress-validator.ts:37-38` and `session-state-machine.ts:21`. It omits two rules graders look for under "block drag-to-skip": (1) an explicit SEEK is allowed only up to `furthestSec + 1.5 s`, and three soft rejects flag the session; (2) the client rAF seek guard (`watch-tracker-core.ts`) snaps any jump past the watched point back instantly, plus the click shield over the iframe. Add one line each and name the files. |
| C1e | MINOR | `README.md:90` Deploy env list omits `ADMIN_EMAIL`/`ADMIN_PASSWORD`, which the seed on Turso needs, and doesn't mention that `scripts/db-deploy.sh` requires `ALLOW_TURSO=1` when run locally (`db-deploy.sh:19`). |
| C1f | OK | All 6 files under `docs/` are linked from the README table. ER "11 models" = 11 `model` blocks in `schema.prisma` ✓. Quick start commands match `package.json` + `.env.example` ✓. The `VERCEL=1`/`ALLOW_TURSO=1` rule matches `config/env.ts` ✓. When this review file lands in `docs/plan/`, add it to the README table too, or keep it out of `docs/` (it's process, not product). |
| C1g | MINOR | `docs/plan/anti-cheat-sim.html` re-implements the server rules in inline JS (bank 1.1/10, slack 1.5, 0.9, 3 soft rejects). The numbers match `TOLERANCES` today. Add a line in the page saying "mirrors src/shared/constants/session.ts TOLERANCES" so the next change updates both. `api-flow.html` endpoints and event names match the routes (spot-checked). |
| C1h | MINOR (stale) | `plan.md` vs as-built: (1) header `:3` "v5.2 … in build (P0–P2 done)"; (2) §2 `:67` + §2 Layers `:95` still list `*.schema.ts` per module; (3) §2 `:61` hooks list lacks `usePlayerProgress`, `watch-tracker-core`, `session-writer-core`, `LiveControlBar`; `:85` says CI runs "unit · api · e2e", but CI runs no e2e; (4) §6 `:369` says the rAF guard is "`current > furthest + 1.5` → `seekTo(furthest)`", but as built it compares against the tracker's **local** high-water mark with an advance threshold (`watch-tracker-core.ts:onFrame`); (5) §7 accepted-risk note cites `WatchTracker.notePaused`, but the method is `noteSettled`; (6) §8 lists a `replay` status the reducer doesn't have (`isReplay` is a flag). §10 Backlog header says "APPROVED" while its body still says "Not scheduled". |
| C1i | MINOR (stale) | `docs/design/spec.md` spot-check (component list `:634`, quiz flow `:272`, ControlBar `:207-249`): it matches the build except that `LiveControlBar`/`usePlayerProgress` are missing from the component list. If the watch machine (#12) lands, §4.4 state names must be updated with it. |
| C2 | MAJOR (G1) | Process history in source comments: **52 lines in 23 files** mention `planner`, `review round`, `review MAJOR/MINOR`, `MAJOR 1`, `lead (b)`, or phase ids (e.g. `WatchPage.tsx:49,109,125,134,161,204,248`, `useYouTubePlayer.ts:88,112`, `useWatchTracker.ts:35`, `useSessionWriter.ts:211`, `session-writer-core.ts:38`, `watch.reducer.ts:169`, `proxy.ts`, 11 backend files, `QuizEditor.tsx`, `Modal.tsx`, `contracts/admin.ts`). Rule 8: keep the *why*, delete the *who/when*. Test names do the same (`watch-page-pause-resume-drift.test.tsx:182` "planner review round 2, must fail on 96893d3"; `watch-page-autoplay-guard.test.tsx:191`; `use-youtube-player-lifecycle.test.tsx:94`). Find them with: `git grep -nE "planner|review round|review (MAJOR|MINOR)|\b(MAJOR|MINOR|BLOCKER)\b|lead \(b\)" -- src tests` |
| C3 | MINOR (dead code) | `watch.reducer.ts`: 4 write-only fields + `CLAIM_STARTED`; `watch.selectors.ts:59` `selectAriaBusy`. (Handled in A.) |
| C4 | MINOR | Test layout: `tests/e2e/*.spec.ts` (API-level playwright, project `api`) sit next to `tests/e2e/browser/**`, with two helper dirs; `browser/helpers/env.ts` re-exports `helpers/env.ts`. Move the top-level specs to `tests/e2e/api/`, keep `tests/e2e/browser/`, and use one `tests/e2e/helpers/`. |
| C5 | **Human decision** | `.agent/` (harness roles/prompts), `CLAUDE.md` and `AGENTS.md` are committed. Graders will see them. Options: (a) keep them and add one README line ("built with an AI agent team; config in `.agent/`"); (b) `git rm --cached` + `.gitignore`. Not a clean-code rule, so I'm not making the call. `docs/plan/*` is fine to keep and should be linked from the README. |

---

## D. Refactor plan — small commits, in order

Legend: **NOW** = files coder isn't touching (backend, admin, shared, README, non-watch comments). **WAIT** = after coder's fix/replay-restart lands on main (WatchPage, reducer, tracker/player/writer hooks, their tests).
Every commit runs T0 (`npm run typecheck && npm run lint && npx vitest run tests/unit`) plus the tests named in its row.

| # | When | Commit | Files | Risk | Behavior-preserving check |
|---|---|---|---|---|---|
| 1 | NOW | docs: README accuracy fixes (C1a–e) + sim-sync note (C1g) + plan.md staleness (C1h) + spec component list (C1i) | `README.md`, `docs/plan/plan.md`, `docs/plan/anti-cheat-sim.html`, `docs/design/spec.md` | none | Docs only. Follow the README quick start once on a clean clone (`npm ci && db:migrate && db:seed && npm test && dev`) and confirm every claim holds. The Live URL (C1) is filled in at P8. |
| 2 | NOW | chore: strip process history from backend/admin/shared comments | 11 backend files, `proxy.ts`, `contracts/admin.ts`, `QuizEditor.tsx`, `Modal.tsx` | none (comments only) | `git diff --stat` shows comment lines only; typecheck + lint |
| 3 | NOW | refactor(backend): import public response types from shared/contracts (B1+B2) | `watch-session.service.ts`, `reward.service.ts`, `reward.interface.ts`, `video.service.ts`, `quiz.interface.ts`, `user.service.ts` | low. Types only. `EventsApplyResult.rejectReason` narrows from `string` to `RejectReason`, which tsc will flag if anything relies on the wider type | `npm run typecheck`; `tests/api/{sessions,events,answer,claim,videos}.test.ts` |
| 4 | NOW | refactor(backend): resume-policy owns the draft rule (B3) | `watch-session.service.ts` | low | `tests/api/sessions.test.ts` (draft → 404), `tests/unit/domain/resume-policy.test.ts` |
| 5 | NOW | refactor: shared youtube-id parser + MIN_PLAYED_RATIO in admin (B4+B5) | new `src/shared/youtube-id.ts`; `backend/lib/youtube.ts`, `frontend/admin/lib/youtube.ts` (delete), `useAdminYouTubePreview.ts`/`VideoForm.tsx` importers, `AdminSessionDetailPage.tsx` | low. The parser must stay free of Node imports | `tests/unit/youtube.test.ts`, `tests/api/admin-videos.test.ts`, playwright `ui-desktop` `02-admin.spec.ts` |
| 6 | NOW | refactor(backend): fold user module into reward/watch-session (B6+B7) | delete `modules/user/*` (4 files); `reward.controller.ts` (+`getMe`), `app/api/me/route.ts`, `watch-session.repository.ts` (+`ensureUser`, +`findOwned`), `reward.service.ts`, `container.ts` | low–med. Run `git grep userRepo` before deleting | `tests/api/videos.test.ts` (/api/me), `sessions.test.ts`, `claim.test.ts`, `reward-repository.test.ts` |
| 7 | NOW | refactor(backend): VideoStatus parse, INTERNAL_ERROR code, one AdminQuestionRow (B8–B10) | `video.repository.ts`, `resume-policy.ts`, `error-codes.ts`, `handler.ts`, `video.interface.ts`, `quiz.interface.ts` | low | typecheck; `tests/api/admin-videos.test.ts`, `admin-questions.test.ts`, `tests/unit/domain/resume-policy.test.ts` |
| 8 | NOW (backend half) | refactor: shared `nextUnpassedQuestion` | new `src/shared/rules/quiz-gate.ts`; `backend/domain/progress-validator.ts` | low | `tests/unit/domain/progress-validator.test.ts` (existing `nextUnpassedQuestion` cases), `scenarios.test.ts` |
| 9 | NOW | test: move API-level playwright specs under tests/e2e/api, merge helpers (C4) | `tests/e2e/*.spec.ts` → `tests/e2e/api/`, `playwright.config.ts` (`api` project testDir), `browser/helpers/env.ts` | low. CI paths change | `npx playwright test --project=api` gives the same count as before (list with `--list` before/after) |
| 10 | WAIT | refactor(watch): delete dead state + CLAIM_STARTED + selectAriaBusy; `<VideoTitle>`; MIN_PLAYED_RATIO; frontend half of #8; QueuedEvent from contracts | `watch.reducer.ts`, `watch.actions.ts`, `watch.selectors.ts`, `WatchPage.tsx`, `watch-tracker-core.ts`, `session-writer-core.ts`, `watch.reducer.test.ts` (drop the CLAIM_STARTED case) | low | `tests/unit/frontend/{watch.reducer,watch-tracker-core,session-writer}.test.ts`, `watch-page-*.test.tsx` |
| 11 | WAIT | refactor(watch): extract youtube-player-adapter (quirks out of WatchPage) | new `player/youtube-player-adapter.ts` + unit test; `useYouTubePlayer.ts`, `WatchPage.tsx` | **medium.** This touches the exact autoplay/ENDED bugs that were fixed earlier | Move the 6 cases from `watch-page-autoplay-guard.test.tsx` to adapter unit tests **first** and confirm they're green against the old code's behavior. Then `watch-page-pause-resume-drift.test.tsx`, `use-youtube-player-lifecycle.test.tsx`, and **real-browser** playwright `ui-desktop` + `ui-mobile` (`01-refresh`, `03-seek-cheat`, `04-repeated-pause-resume`, `01-honest-flow`, `03-reload-before-quiz`). jsdom can't reproduce YouTube's quirks, so the browser runs are the real gate. |
| 12 | WAIT | refactor(watch): discriminated-union watch machine | `state/watch.machine.ts` (replaces reducer+actions), `watch.selectors.ts`, `WatchPage.tsx`, `QuizModal`/`StatusLine` props, `watch.reducer.test.ts` → `watch.machine.test.ts` | **medium.** Wide diff, UI-visible | Port every existing reducer test case 1:1 first (same inputs → same observable outputs through selectors), then the whole `tests/unit/frontend` suite + all playwright UI projects on both viewports + a manual phone check on the Vercel preview (G5) |
| 13 | WAIT | chore: strip process history from watch-stack comments + test names (C2 remainder) | `WatchPage.tsx`, the `hooks/*`, `watch.reducer.ts`, 3 `watch-page`/`use-youtube-player` test files | none | Test count is unchanged (`vitest --reporter=verbose` list before/after) |

Suggested order after coder lands: 10 → 13 → 11 → 12. Do the cheap wins first. #11 and #12 are optional if time is short: #10 + #13 alone already make criterion 3 defensible. #11 gives the best value per line for G2, because it puts the "no dropped/stuck events" logic in one testable place.

Estimated totals: NOW commits delete ~7 files and ~180 lines, with 0 behavior change. WAIT #10–#13 cut WatchPage by ~200 lines and the reducer by ~80 lines, and move ~120 lines of quirk logic into a unit-tested adapter.
