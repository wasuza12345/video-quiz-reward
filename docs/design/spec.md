# Design Spec — Mini Interactive Video Quiz & Reward

Status: v1 (designer, 2026-09-24) · Source: `docs/plan/plan.md` §3 (API), §4 (anti-cheat), §5 (UI state)
Scope: one page (`src/app/page.tsx` → `<QuizVideoExperience/>`), mobile-first 360–430px, also works on desktop.

> Rule: no API fields are invented here. All dynamic text (quiz prompt, choice text, points) comes from
> `/api/me` and `/api/sessions`. Items marked **[ASK]** are open questions for the planner (§9).

---

## 1. Page layout

### Mobile (360–430px) — one column, no horizontal scroll
```
┌──────────────────────────────── 16px gutter ─┐
│ Header (56px, sticky)                        │
│  "ดูคลิป ตอบคำถาม รับแต้ม"        [⭐ 50 แต้ม] │ ← PointsBadge (always visible)
├──────────────────────────────────────────────┤
│ RewardBanner (only in rewarded / already_…)  │
├──────────────────────────────────────────────┤
│ VideoPlayer 16:9 (full content width)        │
│  ┌────────────────────────────────────────┐  │
│  │  YouTube iframe (controls:0)           │  │
│  │  + transparent click shield            │  │
│  │                 [ ▶ ]  (center, 64px)  │  │ ← only when paused/ready
│  └────────────────────────────────────────┘  │
│  ControlBar (below video, 56px)              │
│  [▶/❚❚ 48px]  0:13 / 0:44  ▓▓▓▓▓░◆░░░░░░░    │ ← read-only progress + quiz marker ◆
├──────────────────────────────────────────────┤
│ StatusLine (1 line, aria-live)               │
│  "ดูให้จบ + ตอบคำถาม 1 ข้อ เพื่อรับ 50 แต้ม"   │
├──────────────────────────────────────────────┤
│ HowItWorks (3 steps, small)                  │
│  ① ดูคลิปจนจบ ② ตอบคำถามที่เด้งขึ้น ③ รับแต้ม  │
└──────────────────────────────────────────────┘
```
- Controls sit **below** the video, not overlaid: on a 360px screen the video is only ~184px tall and an
  overlay bar would cover content; below also keeps the tap target clear of YouTube's own overlays.
- Max content width 720px, centered. Page background `--bg`, cards `--surface`.

### Desktop (≥768px)
- Same single column, `max-width: 720px`, header spans full width with inner max 720px.
- Quiz modal becomes a centered dialog (max-width 480px) instead of a bottom sheet.
- Space/K keys map to Play/Pause **only when focus is on the Play button** (YouTube `disablekb:1` stays on;
  our button handles Enter/Space natively). No arrow-key seeking.

---

## 2. Design tokens (CSS custom properties in `globals.css`)

| Token | Value | Use | Contrast (verified) |
|---|---|---|---|
| `--bg` | `#F8FAFC` | page | text on it 17.06:1 |
| `--surface` | `#FFFFFF` | cards, modal | |
| `--text` | `#0F172A` | body text | 17.06:1 on bg |
| `--text-muted` | `#475569` | secondary text, time | 7.58:1 on surface |
| `--primary` | `#4F46E5` | Play button, primary CTA, progress fill | white text on it 6.29:1; fill vs track 5.1:1 |
| `--primary-hover` | `#4338CA` | hover/pressed | |
| `--track` | `#E2E8F0` | progress track | |
| `--quiz-marker` | `#92400E` | ◆ quiz point on progress | ≥3:1 on track |
| `--success` | `#047857` | correct answer, reward | white on it 5.48:1 |
| `--success-bg` | `#ECFDF5` | reward banner bg | success text 5.21:1 |
| `--danger` | `#B91C1C` | wrong answer, errors | 5.91:1 on danger-bg |
| `--danger-bg` | `#FEF2F2` | error message bg | |
| `--points-bg` | `#FEF3C7` | PointsBadge bg | points text 6.37:1 |
| `--points-text` | `#92400E` | PointsBadge text | |
| `--scrim` | `rgba(15,23,42,.72)` | modal backdrop, center-play circle | white on it ≥12:1 |
| `--focus` | `#4F46E5` 3px outline + 2px offset | every focusable | |

Never use `#94A3B8` for text (2.56:1 — fails AA).

Type: font `"Noto Sans Thai", "Sarabun", system-ui, sans-serif` (Thai glyphs; Google Fonts).
Sizes: `--fs-xs 13px` (helper), `--fs-sm 14px`, `--fs-md 16px` (body, min for inputs), `--fs-lg 18px`
(quiz prompt), `--fs-xl 22px` (banner title). Line-height 1.6 for Thai (tall tone marks).
Spacing scale 4 / 8 / 12 / 16 / 24 / 32. Radius `--r-sm 8px`, `--r-md 12px`, `--r-lg 16px`, pill 999px.
Motion: 150–250ms ease-out; all motion disabled under `prefers-reduced-motion: reduce`.
Dark mode: out of scope for v1 (light only); tokens make it a later swap.

---

## 3. Components

### 3.1 PointsBadge (header, always visible, every state)
- Pill, `--points-bg` / `--points-text`, 14px bold, min height 32px (not interactive → no 44px rule).
- Content: `⭐ {totalPoints} แต้ม` (number with `toLocaleString('th-TH')`).
- `aria-label="แต้มสะสม {totalPoints} แต้ม"`; wrapped in `role="status"` so the +50 change is announced once.
- States:
  - loading → skeleton pill 72×32 (shimmer; static under reduced motion), text hidden, `aria-busy="true"`.
  - normal → number.
  - just-awarded → number counts up 0→50 over 600ms + one pulse (scale 1→1.08→1); reduced-motion: instant.
  - `/api/me` failed → show `⭐ – แต้ม`, no error UI here (page-level error handles it).

### 3.2 VideoPlayer
- 16:9 box (`aspect-ratio: 16/9`), black background, `--r-md` corners, overflow hidden.
- YouTube iframe params (plan §4): `controls:0, disablekb:1, fs:0, rel:0, modestbranding:1, playsinline:1`.
- **Click shield**: transparent `<div>` over the iframe so taps do not reach YouTube UI (no hidden seeking via
  YouTube's own tap handlers). Tapping the shield = toggle Play/Pause (same handler as the button).
- Center play overlay (ready / paused only): 64px circle, `--scrim` bg, white ▶ icon; `aria-hidden` (the
  ControlBar button is the accessible control).
- iframe `title="วิดีโอ: {video title}"` **[ASK: `/api/sessions` has no title field — use a fixed string?]**

### 3.3 ControlBar
- Row, height 56px, gap 12px, `--surface`, below the player.
- **Play/Pause button**: 48×48, `--primary`, white icon, radius pill.
  `aria-label` = `"เล่นวิดีโอ"` / `"หยุดชั่วคราว"`; `aria-pressed` not used (label swaps instead).
- **Time**: `m:ss / m:ss` (`0:13 / 0:44`), tabular-nums, `--text-muted` 14px.
- **Progress (read-only)**: flex-1, 6px bar, track `--track`, fill `--primary`.
  - `role="progressbar"` + `aria-valuemin=0 aria-valuemax={durationSec} aria-valuenow={current}`
    `aria-valuetext="ดูไปแล้ว 0:13 จาก 0:44"`. **Not** a slider: no thumb, no pointer handlers, not focusable,
    `cursor: default`. This is the "no seek-forward affordance".
  - Quiz marker ◆ at `triggerSec / durationSec`, 10px diamond `--quiz-marker`; after quiz passed → turns
    `--success` with ✓ (`aria-hidden`; the StatusLine says it in words).
- No fullscreen, speed, volume or seek buttons (YouTube volume via device keys only).

### 3.4 SeekGuardToast (client anti-cheat feedback)
- When the rAF loop snaps back (`current > maxAllowed + 1.5`): small toast above ControlBar for 2.5s:
  **"ข้ามช่วงวิดีโอไม่ได้ ระบบพากลับไปจุดที่ดูถึง"**. `role="status"`. Max once per 5s (don't spam).
- Same toast when server returns `rejected:true` from `/progress`.

### 3.5 QuizModal
- Mobile: **bottom sheet** (full width, `--r-lg` top corners, max-height 85vh, scroll inside).
  Desktop ≥768px: centered dialog, max-width 480px.
- Backdrop `--scrim` covers the page, including the video (video is already paused).
- `role="dialog" aria-modal="true" aria-labelledby=quiz-title aria-describedby=quiz-prompt`.
  **No close button, Esc does nothing, backdrop tap does nothing** — the quiz is required to continue
  (plan §5). A helper line explains it so the user is not trapped without context.
- Content, top → bottom:
  1. Eyebrow `คำถาม 1/1` (`--text-muted` 13px)
  2. Title `id=quiz-title`: **"ตอบคำถามเพื่อดูต่อ"** (18px bold)
  3. Prompt `id=quiz-prompt`: `{quiz.prompt}` (from API, 18px)
  4. Choice list: `role="radiogroup"`-free — use 4 **buttons** (one tap = submit; fewer steps on mobile).
     Each: full width, min-height 56px (≥44 ✓), 16px text, left badge with `{label}` (A–D) 32px circle,
     then `{text}`. Gap 8px. Border 1.5px `--track`, radius `--r-md`.
     `aria-label="ตัวเลือก {label}: {text}"`.
  5. Feedback area (`aria-live="assertive"`, reserves 0 height until used).
  6. Helper: **"วิดีโอจะเล่นต่อเมื่อตอบถูก"** 13px muted.
- Focus: on open → focus the title (so the prompt is read first), trap Tab inside; on close → focus returns
  to the Play/Pause button.
- Choice button states:

| State | Visual | Behaviour |
|---|---|---|
| default | white, `--track` border | tappable |
| hover/focus | `--primary` border, 3px focus ring | |
| submitting (the tapped one) | spinner replaces label badge, all 4 `disabled` + `aria-busy` | waits for `/answer` |
| wrong | `--danger` border + `--danger-bg`, ✕ icon, **stays disabled** | other 3 re-enabled |
| correct | `--success` border + `--success-bg`, ✓ icon | 800ms, then modal closes and video resumes |

  Wrong choices stay disabled for the rest of this modal so the user does not retry the same one.
  **[ASK: should retry allow re-tapping the same wrong choice? Spec assumes no.]**
  Colour is never the only signal: icon + text message always accompany it.

### 3.6 RewardBanner
- Card under the header, above the player, `--success-bg`, 4px left border `--success`, radius `--r-md`,
  padding 16px. Not a toast — it stays (the page's final state).
- Enter: slide-down 250ms + small confetti burst (CSS, 1s, max 24 particles); reduced-motion: fade only.
- `role="status"` (announces once). Focus is **not** moved to it.
- Variants in §5 (`rewarded`, `already_rewarded`).

### 3.7 StatusLine
- One line under the ControlBar, 14px, `aria-live="polite"`. Text per state in §5. Icon + text.

### 3.8 ErrorPanel
- Replaces the player area (keeps the 16:9 box so layout does not jump), `--danger-bg`, centered content:
  icon, title, body, and a **"ลองใหม่"** button (48px tall, `--primary`). `role="alert"`.

---

## 4. State × component matrix (plan §5)

| State | PointsBadge | Player / center ▶ | Play button | Progress | Quiz | Banner | StatusLine |
|---|---|---|---|---|---|---|---|
| `loading` | skeleton | skeleton 16:9 (shimmer) | disabled skeleton | hidden | – | – | "กำลังโหลดวิดีโอ…" |
| `ready` | total | poster + ▶ | ▶ enabled | at `positionSec` | – | – | intro / resume copy |
| `playing` | total | video | ❚❚ | moving | – | – | "กำลังเล่น · คำถามจะขึ้นที่ 0:13" / after pass "ตอบถูกแล้ว ดูต่อให้จบเพื่อรับแต้ม" |
| `paused` | total | frame + ▶ | ▶ | frozen | – | – | "หยุดชั่วคราว" |
| `quiz_open` | total | frozen under scrim | disabled (behind modal) | frozen at 0:13 | open | – | – |
| `quiz_open` + error | total | same | same | same | wrong feedback | – | – |
| `ended` | total | last frame, no ▶ | disabled | 100% | – | – | "ดูจบแล้ว กำลังบันทึกแต้ม…" |
| `claiming` | total | same | disabled | 100% | – | – | spinner + "กำลังบันทึกแต้ม…" |
| `rewarded` | count-up to new total | last frame + "ดูอีกครั้ง" ▶ **[ASK]** | ▶ (replay) | 100%, marker ✓ | – | success | – |
| `already_rewarded` | total | playable, no quiz lock **[ASK]** | ▶ | normal | – | info | – |
| `error` | total or "–" | ErrorPanel | hidden | hidden | – | – | – |

`ended` → `claiming` is automatic (client calls `/complete` on the YouTube `ENDED` event); the user never
taps a "claim" button. **[ASK: confirm auto-claim, no button.]**

---

## 5. Screens & Thai copy per state

### 5.1 loading
- Skeleton: badge pill, 16:9 grey box, 48px circle, bar. No spinner inside the 16:9 box (skeleton only).
- If loading > 8s → StatusLine: "ใช้เวลานานกว่าปกติ ตรวจสอบอินเทอร์เน็ตของคุณ".
- Screen reader: `aria-busy="true"` on main; StatusLine "กำลังโหลดวิดีโอ…".

### 5.2 ready (new session, `positionSec = 0`)
- StatusLine: **"ดูคลิปให้จบและตอบคำถาม 1 ข้อ เพื่อรับ {rewardPoints} แต้ม"**
- Center ▶ + Play button enabled. Mobile autoplay is not assumed (browsers block it with sound).

### 5.3 ready — resumed after refresh (`positionSec > 0`, plan D3)
- StatusLine: **"ดูต่อจาก {m:ss} ที่ดูค้างไว้"** · Progress already filled to `positionSec`.
- If session `status = quiz_passed` → marker already ✓, no quiz again.

### 5.4 playing / paused
- Copy in §4 table. Center ▶ appears only when paused.
- Tab hidden (`visibilitychange`) → client pauses? **[ASK: plan says heartbeat on visibilitychange; does
  playback also pause? Spec assumes: we pause, StatusLine "หยุดชั่วคราว".]**

### 5.5 quiz_open
- Auto-pause at `triggerSec` (≤1 frame), then the sheet slides up 200ms.
- Title **"ตอบคำถามเพื่อดูต่อ"** · prompt `{quiz.prompt}` · 4 choices `{label} {text}` · helper
  **"วิดีโอจะเล่นต่อเมื่อตอบถูก"**.

### 5.6 quiz_open + error (wrong answer, `correct:false`)
- Tapped choice → red + ✕; feedback area: **"ยังไม่ถูก ลองเลือกข้ออื่นอีกครั้ง"** (`--danger`, ✕ icon).
- Small shake 300ms on the choice (off under reduced motion). Modal stays open; others re-enabled.
- Network/5xx on `/answer`: feedback **"ส่งคำตอบไม่สำเร็จ กรุณาลองอีกครั้ง"**; the tapped choice is **not**
  marked wrong and is re-enabled.
- `409 NOT_AT_QUIZ`: **"ตำแหน่งวิดีโอไม่ตรงกับคำถาม ระบบกำลังพากลับ…"** → client seeks to `triggerSec`,
  keeps modal open.

### 5.7 correct → playing
- Choice green + ✓; feedback **"ถูกต้อง! ดูต่อได้เลย"**; after 800ms the sheet slides down, focus returns to
  Play/Pause, video resumes automatically. Marker turns ✓.

### 5.8 ended / claiming
- StatusLine with spinner: **"ดูจบแล้ว กำลังบันทึกแต้ม…"**. Play disabled so the user can't restart mid-claim.
- `/complete` fails:
  - network/5xx → inline under player (not full ErrorPanel, the video is done):
    **"บันทึกแต้มไม่สำเร็จ"** + button **"ลองบันทึกอีกครั้ง"** (retry `/complete`, it is idempotent).
  - `422 NOT_WATCHED` → **"ระบบยังไม่นับว่าดูครบ กรุณาดูคลิปให้จบโดยไม่ข้าม"** + button **"ดูอีกครั้งตั้งแต่ต้น"**
    (seekTo 0, play).
  - `422 QUIZ_NOT_PASSED` → **"ยังไม่ได้ตอบคำถาม"** + button **"ดูอีกครั้ง"** (should not happen via UI).

### 5.9 rewarded (`awarded:true`)
- Banner title **"ยินดีด้วย! +{points} Points"** (22px bold `--success`) — wording as requested by planner.
  **[ASK: "Points" in English or "แต้ม"? Spec uses "Points" in the banner title only, "แต้ม" elsewhere.]**
- Body: **"คุณดูคลิปจบและตอบคำถามถูก ได้รับ {points} แต้ม · แต้มสะสมทั้งหมด {totalPoints} แต้ม"**
- Badge counts up to `totalPoints`.

### 5.10 already_rewarded (`alreadyRewarded:true` from `/api/sessions`, or `/complete` → `awarded:false`)
- Banner (info tone: `--surface` + 4px `--primary` border, ℹ icon):
  title **"คุณได้รับแต้มจากคลิปนี้แล้ว"** · body **"ดูซ้ำได้ แต่จะไม่ได้รับแต้มเพิ่ม"**.
- Shown **on page load** (before playing) so the user is not surprised at the end. No confetti, no count-up.
- Quiz on replay: **[ASK]** spec assumes quiz still appears (same player behaviour, simplest reducer), but
  banner already tells them no points.

### 5.11 error (page-level ErrorPanel)
| Cause | Title | Body | Action |
|---|---|---|---|
| `/api/sessions` 404 `VIDEO_NOT_FOUND` | ไม่พบวิดีโอนี้ | วิดีโออาจถูกลบหรือปิดการเผยแพร่ | none (no retry) |
| YouTube player `onError` / API script failed | เล่นวิดีโอไม่ได้ | วิดีโอนี้ไม่สามารถเล่นได้ในขณะนี้ | ลองใหม่ (reload player) |
| network / 5xx on `/me` or `/sessions` | โหลดข้อมูลไม่สำเร็จ | กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ | ลองใหม่ |
| `403 NOT_OWNER` (any) | เซสชันหมดอายุ | กรุณาโหลดหน้าใหม่เพื่อเริ่มต่อ | โหลดหน้าใหม่ |
| offline (`navigator.onLine=false`) during playing | (toast, not panel) | "ขาดการเชื่อมต่อ ความคืบหน้าอาจไม่ถูกบันทึก" | auto-hide when back online |

- `/progress` `409 QUIZ_REQUIRED` is not a page error: client seeks back to `triggerSec` and opens the quiz.

---

## 6. Interaction timeline (happy path)
① Page load → `loading` (skeletons) → `GET /api/me` + `POST /api/sessions` in parallel
② both OK → `ready` (or `already_rewarded` banner + ready)
③ tap ▶ → `playing`; progress moves; heartbeat every 5s (invisible)
④ `current ≥ 13s` → auto-pause → `quiz_open` sheet
⑤ wrong → red + retry copy; correct → green 800ms → sheet closes → `playing`
⑥ YouTube `ENDED` → `ended` → auto `POST /complete` → `claiming`
⑦ `awarded:true` → `rewarded` banner + badge count-up · refresh → `already_rewarded` banner, badge keeps total

---

## 7. Accessibility checklist
- Tap targets ≥44×44: Play 48, choices ≥56 tall, retry buttons 48 tall. Badge/progress are non-interactive.
- Contrast AA: all text pairs in §2 ≥4.5:1 (verified by script); non-text (progress fill, marker, borders
  of choices) ≥3:1.
- Keyboard: Tab order = Play/Pause → (modal traps focus when open) → retry buttons. Visible `--focus` ring
  everywhere (`:focus-visible`). No keyboard seeking exists.
- Screen reader: Play button label swaps; progressbar has `aria-valuetext` in Thai; StatusLine polite,
  quiz feedback assertive, reward banner status, errors alert. Page `lang="th"`.
- Modal: `aria-modal`, focus trap, focus restore; background gets `inert`.
- Never colour alone: ✓/✕ icons + text for correct/wrong/reward/error.
- `prefers-reduced-motion`: no shimmer, no shake, no confetti, no count-up (instant).
- Zoom to 200% / text-size increase: layout is single column and wraps; no fixed heights on text containers
  (choices use min-height).

## 8. Responsive checks for tester (P4)
- 360×640, 390×844, 430×932 and 1280×800: no horizontal scroll; quiz sheet fits without covering the whole
  prompt; all 4 choices visible without scroll at 360×640 when choice text ≤ 2 lines each.
- Landscape phone (640×360): sheet max-height 85vh scrolls internally.

## 9. Open questions for planner **[ASK]**
1. `/api/sessions` has no video title → iframe `title` / header text: fixed string ok?
2. Retry: may the user re-tap a choice already marked wrong? (spec: no, it stays disabled)
3. Auto-claim on `ENDED` with no button? (spec: yes)
4. After `rewarded` / in `already_rewarded`: allow replay? Does the quiz lock still apply on replay?
   (spec: replay allowed, quiz still shown, no points)
5. Pause playback on `visibilitychange` (tab hidden)? (spec: yes)
6. Banner wording: "+50 Points" (English) vs "+50 แต้ม"? (spec: "Points" in banner title only, per request)
