# Design Spec v2 — Mini Interactive Video Quiz & Reward

Status: **v2.1** (designer, 2026-09-24) · replaces v1 (single page). v2.1: all [CONTRACT] items closed by plan §4.5; exact keys used.
Sources: `docs/plan/plan.md` **v5.1** (§1 pages, §2 folders, §4 API incl. §4.5 response shapes, §5 state machine, §6 anti-cheat, §7 backoffice,
§8 public UI state, §11 decisions) + `docs/design/reference-engonair.md` (tokens, components, copy tone).

Rules followed: EngOnAir tokens · LINE Seed Sans TH (self-hosted, OFL 1.1) → fallback Noto Sans Thai · **no EngOnAir
logo** · ครูหวาน voice ("ค่ะ/นะคะ") · tap targets ≥ 44 px · WCAG 2.2 AA (every colour pair below was computed with
the WCAG formula, not estimated) · no API field is invented. Where the UI needs data whose response shape the plan
did not define, the item was marked **[CONTRACT]**; all are now closed by **plan §4.5** (see §9).

Contents: §1 Foundations · §2 Shells · §3 `/` · §4 `/watch/[videoId]` · §5 Backoffice · §6 Component inventory ·
§7 Accessibility · §8 Responsive/test checklist · §9 Contract items (closed)

---

## 1. Foundations

### 1.1 Colour tokens (`src/app/globals.css` → `:root`)
| Token | Value | Use | Verified contrast |
|---|---|---|---|
| `--brand-primary` | `#1D3793` | headers, admin sidebar, tags, links, progress fill, focus ring | white on it 10.4 · on `--bg` 8.97 · on white 10.4 · vs `--track` 8.43 |
| `--brand-primary-dark` | `#1A2A5E` | headings, card titles, reward card start | white on it 13.67 |
| `--brand-primary-2` | `#2B4BB5` | reward card gradient end | white 7.56 · gold 5.25 |
| `--brand-accent` | `#D81E1D` | **primary CTA only** (filled pill), quiz marker | white on it 5.09 · vs `--track` 4.13 |
| `--brand-accent-hover` | `#B91C1C` | CTA hover/pressed | white 6.47 |
| `--bg` | `#F0EEE9` | page background (public) | |
| `--bg-admin` | `#F8FAFC` | page background (admin) | |
| `--surface` | `#FFFFFF` | cards, modals, tables | |
| `--surface-2` | `#F1F5F9` | table header, disabled field bg | |
| `--text` | `#111827` | body | 15.3 on `--bg` |
| `--text-2` | `#475569` | secondary text; **the only muted colour allowed on `--bg`** | 6.54 on `--bg` · 7.24 on `--bg-admin` |
| `--text-muted` | `#64748B` | meta text **on white only** | 4.76 on white · 4.55 on `--bg-admin` · ✗ 4.1 on `--bg` |
| `--border` | `#E2E8F0` | decorative card borders only (1.23:1, not a control boundary) | |
| `--border-control` | `#64748B` | input, choice-button and outline-button borders | 4.76 vs white (≥ 3:1 for UI, WCAG 1.4.11) |
| `--track` | `#E2E8F0` | progress track | |
| `--gold` | `#FCD34D` | star + "+50" on the reward card (on navy only) | 9.48 on `#1A2A5E` · 5.25 on `#2B4BB5` |
| `--success` / `--success-bg` | `#047857` / `#ECFDF5` | correct answer, "ได้แต้มแล้ว", published | 5.48 on white · 5.21 on its bg |
| `--danger` / `--danger-bg` | `#B91C1C` / `#FEF2F2` | wrong answer, errors, rejected events | 5.91 on its bg · 6.47 white on it |
| `--warning` / `--warning-bg` | `#92400E` / `#FEF3C7` | flagged sessions, "draft", lock notices | 6.37 on its bg · 7.09 on white |
| `--info-bg` | `#EEF2FF` | replay/info banners (text `--brand-primary`) | 9.3 |
| `--scrim` | `rgba(15,23,42,.72)` | modal backdrop, centre-play circle | white ≥ 12 |
| `--focus` | 3 px `--brand-primary` outline + 2 px offset (on navy surfaces: 3 px white) | every `:focus-visible` | |

Rules (from reference §4): red = "press this" only; **red is never placed on navy** (2.04:1); wrong answers use the
*light* danger style (bg + border + ✕ + text), never a filled red; `#94A3B8` is never used for text.

### 1.2 Typography
- `--font: "LINE Seed Sans TH", "Noto Sans Thai", sans-serif;` woff2 Regular (400) + Bold (700) self-hosted in
  `public/fonts/`, `font-display: swap`, preload both. (Licence rule: if LINE Seed is ever disallowed → Noto Sans Thai
  only, one token change.) Weights 800/900 from the reference map to Bold 700 (the family ships Rg/Bd only).
- `line-height: 1.6` body, 1.35 headings (Thai tone marks need room). Numbers: `font-variant-numeric: tabular-nums`.

| Token | Mobile | ≥ 1025 px | Use |
|---|---|---|---|
| `--fs-display` | 28px | 40px | `/` hero title |
| `--fs-h1` | 24px | 32px | page titles |
| `--fs-h2` | 20px | 24px | section titles, reward "+50" label |
| `--fs-lg` | 18px | 18px | quiz prompt, card title |
| `--fs-md` | 16px | 16px | body, inputs (never < 16px in inputs → no iOS zoom) |
| `--fs-sm` | 14px | 14px | meta, table cells |
| `--fs-xs` | 13px | 13px | tags, helper text (**minimum size**) |
| `--fs-score` | 56px | 72px | "+50" on the reward card |

### 1.3 Spacing, shape, elevation, motion
- Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48. Gutter 16px (≤ 600) · 24px (601–1024) · 32px (≥ 1025).
  Content max-width: public 1120px (`/`), 880px (watch); admin fluid with 1400px max.
- Radius: `--radius-pill 50px` (buttons, badges) · `--radius-card 20px` (16px ≤ 600) · `--radius-media 14px` ·
  `--radius-field 12px` · `--radius-tag 6px`.
- Shadow: `--shadow-card 0 12px 35px #0000000D` (≤ 600: `0 5px 5px #0000000D`) · `--shadow-cta 0 4px 15px #D81E1D33` ·
  `--shadow-modal 0 20px 40px -10px #1A2A5E40`.
- Motion: 150–300ms, `cubic-bezier(.25,.8,.25,1)`. Card hover-lift (-8px) only on `(hover:hover)` pointers.
  **`prefers-reduced-motion: reduce` → no lift, no shake, no confetti, no count-up, no shimmer (fades ≤ 150ms only).**
- Breakpoints (aligned to reference): `sm ≤ 600` · `md 601–1024` · `lg ≥ 1025`.

### 1.4 Icons
Inline SVG, 20/24px, `currentColor`, `aria-hidden="true"` (meaning always carried by text or `aria-label`). Set:
play, pause, check, x, star, lock, flag, clock, eye, alert, refresh, arrow-left, menu, logout, plus, trash, edit.

### 1.5 Shared copy formats
- Time `m:ss` (`0:13`, `12:05`); `h:mm:ss` only ≥ 1h. Date/time admin: `24 ก.ย. 2569 14:05` (`th-TH`, Buddhist year).
- Points: `toLocaleString('th-TH')` + " แต้ม" (e.g. `1,250 แต้ม`); reward card uses "Points" (decision §11).
- Voice (public + admin messages): ครูหวาน, warm, short. Encouraging/instructional lines end with "ค่ะ/นะคะ";
  errors are short and say what to do next ("…กรุณาลองใหม่ค่ะ"). Admin **labels** are neutral nouns (no "ค่ะ").

---

## 2. Shells

### 2.1 Public header (`/`, `/watch/*`) — `PublicHeader`
- Sticky, height 56px (≤ 600) / 72px, bg `--brand-primary`, 1px bottom border white 10%.
- Left: **neutral wordmark** = text `APP_NAME` (constant in `frontend/public/constants`, value **final** (human, 2026-09-24):
  **"ดูคลิป รับแต้ม"**), white, 18px Bold; it is a link to `/` (`aria-label="กลับหน้าแรก"`, target ≥ 44px tall).
  No EngOnAir logo or two-colour lettering.
- On `/watch/*` a back link precedes it on ≤ 600: `← ` icon button 44×44, `aria-label="กลับไปหน้ารวมคลิป"`.
- Right: **PointsBadge** (§4.3.1). No hamburger on public pages (nothing to put in it).
- Footer (optional, minimal): `--brand-primary`, white 90%, one line "วิดีโอจาก YouTube เป็นของเจ้าของช่องแต่ละช่อง" 13px.

### 2.2 Admin shell — `AdminShell` (`/admin/(panel)/layout.tsx`)
- **≥ 1025:** left sidebar 240px `--brand-primary`, white text; items 48px tall: แดชบอร์ด · วิดีโอ · ผู้ใช้ · เซสชัน;
  active item: white 12% bg + 4px white left bar + `aria-current="page"`. Bottom: admin email (13px, 80% white) +
  "ออกจากระบบ" (outline-white pill, 44px).
  Main: `--bg-admin`, padding 32px, page title row (h1 + primary action on the right).
- **≤ 1024:** top bar 56px `--brand-primary` with hamburger (44×44, `aria-expanded`, `aria-controls`) → full-screen
  drawer (60vw on 601–1024) — the reference's mobile drawer (C1). Focus trapped in the drawer, Esc closes.
- Admin pages use no ครูหวาน flourishes in labels; messages keep "ค่ะ".
- **Session expired (401 UNAUTHENTICATED on any admin call):** redirect to `/admin/login?reason=expired`
  (login shows the info notice in §5.1).

---

## 3. Public — `/` (VideoListPage)

Data: `GET /api/videos` → `{ featured, videos[] }` (published only) + `GET /api/me` → `{ totalPoints, rewardedVideoIds }`.
Thumbnail = `https://i.ytimg.com/vi/{youtubeId}/hqdefault.jpg` (derived from `youtubeId`, not an API field),
`alt=""` (title is next to it), `loading="lazy"` except the featured image.

### 3.1 Layout
```
≤ 600 (360–430)                              ≥ 1025
┌──────────────────────────────┐            ┌────────────────────────────────────────────────────────────┐
│ Header: ดูคลิป รับแต้ม [⭐ 50] │            │ Header                                        [⭐ 50 แต้ม]  │
├──────────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ PointsSummary (card)          │            │ Hero title ─────────────────────┐  PointsSummary card    │
│ Hero: "ดูคลิปให้จบ ตอบคำถาม    │            │ "ดูคลิปให้จบ ตอบคำถาม รับแต้มค่ะ" │  แต้มสะสม 50 แต้ม      │
│  รับแต้มค่ะ" + 1-line sub       │            │                                 │  ได้แต้มแล้ว 1 คลิป     │
├──────────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ FeaturedVideoCard (stacked)   │            │ FeaturedVideoCard (horizontal)                             │
│ ┌──────────────────────────┐ │            │ ┌───────────────────────────┐  แนะนำ                       │
│ │ 16:9 thumbnail ▶ 0:44    │ │            │ │ 16:9 thumbnail  ▶         │  Title (2 lines)             │
│ └──────────────────────────┘ │            │ │ (58% width)               │  วิดีโอจาก YouTube: channel   │
│ [แนะนำ] [+50 แต้ม] [0:44]     │            │ └───────────────────────────┘  [+50 แต้ม] [0:44] [1 คำถาม] │
│ Title 2 lines                 │            │                                [ เริ่มดูคลิปเลย ]  (red)     │
│ วิดีโอจาก YouTube: channel     │            ├────────────────────────────────────────────────────────────┤
│ [   เริ่มดูคลิปเลย   ] (red)   │            │ "คลิปทั้งหมด" (h2)                                          │
├──────────────────────────────┤            │ ┌──────────┐ ┌──────────┐ ┌──────────┐   3 cols ≥ 1025      │
│ "คลิปทั้งหมด" (h2)             │            │ │VideoCard │ │VideoCard │ │VideoCard │   2 cols 601–1024    │
│ VideoCard (vertical stack,    │            │ └──────────┘ └──────────┘ └──────────┘   1 col ≤ 600       │
│  1 column, gap 12)            │            └────────────────────────────────────────────────────────────┘
└──────────────────────────────┘
```
Question tag = `questionCount` from `GET /api/videos` (plan §4.5): "{questionCount} คำถาม" (hidden when 0).
The featured video is **not repeated** in the list below (filter `videos` by `id !== featured.id`).
No carousel (planner decision).

### 3.2 Components
**PointsSummary** — white card, radius 20, padding 16/24. Label "แต้มสะสมของคุณ" (`--text-2` 14px) ·
value `{totalPoints}` 32px Bold `--brand-primary-dark` + " แต้ม" · sub line "ได้แต้มแล้ว {rewardedVideoIds.length} คลิป"
(hidden when 0). `role="status"` not needed here (static on load).

**FeaturedVideoCard** — white, radius 20, `--shadow-card`, padding 16 (≤ 600) / 24.
Tags row (C5): `แนะนำ` (navy tag), `+{rewardPoints} แต้ม` (warning-bg tag with ⭐), `{m:ss}` (surface-2 tag, clock icon),
`{questionCount} คำถาม` (surface-2 tag, hidden when 0).
Title `--fs-lg`/24px Bold `--brand-primary-dark`, 2-line clamp. Source line `วิดีโอจาก YouTube: {channelName}` 14px
`--text-muted` (hidden when empty). CTA red pill full width ≤ 600, auto width ≥ 601, height 52px.
The **whole card is one link** to `/watch/{id}` (the CTA is the visual target; one `<a>` wrapping, no nested interactive).
Thumbnail overlay: 64px centre play circle `--scrim` + white ▶ (decorative).

**VideoCard** — same anatomy, smaller: radius 20 (16 ≤ 600), padding 16, thumbnail radius 14, title 18px 2-line clamp,
tags `+{rewardPoints} แต้ม` + `{m:ss}`, CTA text link row at the bottom ("ดูคลิป →", 44px tall row) — cards in a list
use a lighter CTA than the featured card so the featured one stays the main action.

Card states:
| State | Condition | Visual | CTA / label |
|---|---|---|---|
| not rewarded | `rewarded:false` | normal | featured: "เริ่มดูคลิปเลย" · list: "ดูคลิป →" |
| rewarded | `rewarded:true` | success tag `✓ ได้แต้มแล้ว` replaces the `+50` tag | featured: outline pill "ดูทบทวน" · list: "ดูทบทวน →" |
| hover (pointer) | – | lift -8px, title → `--brand-accent` (text only, on white: 5.09) | – |
| focus | – | card gets focus ring (radius follows card) | – |
| pressed | – | scale .98 | – |
| thumbnail error | img `onerror` | surface-2 box + play icon | – |

`aria-label` on the card link: "{title} · {m:ss} · {rewarded ? 'ได้แต้มแล้ว' : 'รับ ' + rewardPoints + ' แต้ม'}".

### 3.3 Page states
| State | Trigger | Layout | Copy |
|---|---|---|---|
| **loading** | requests pending | skeletons: PointsSummary box, featured card (16:9 + 3 lines + pill), 3 list cards; `aria-busy="true"` on `<main>` | sr-only "กำลังโหลดคลิป…" |
| **n videos** | featured + ≥ 1 other | featured + h2 "คลิปทั้งหมด" + grid | hero sub: "ดูคลิปให้จบและตอบคำถามให้ถูก รับแต้มสะสมได้เลยค่ะ" |
| **1 video** | featured only, `videos` has no other item | featured card only; **no** "คลิปทั้งหมด" heading, no empty list message | same hero; below the card a quiet line (`--text-2`): "คลิปใหม่กำลังจะมาเร็วๆ นี้นะคะ" |
| **list but no featured** | `featured:null`, `videos.length ≥ 1` | no featured block; the first video renders as FeaturedVideoCard **without** the "แนะนำ" tag; rest in grid | same |
| **0 videos (empty)** | `featured:null`, `videos:[]` | centred EmptyState card (illustration-free: 48px play icon in a 96px `--surface-2` circle) | title "ยังไม่มีคลิปให้ดูตอนนี้ค่ะ" · body "แวะกลับมาใหม่เร็วๆ นี้นะคะ เรากำลังเตรียมคลิปดีๆ ไว้ให้" · no button |
| **all rewarded** | every video `rewarded:true` | normal; PointsSummary sub line + banner (info-bg): "เก่งมากค่ะ! ดูครบทุกคลิปแล้ว ดูทบทวนได้เสมอนะคะ" | |
| **error** | `/api/videos` fails (network/5xx) | ErrorState card in place of the list, PointsSummary kept if `/api/me` succeeded | title "โหลดรายการคลิปไม่สำเร็จ" · body "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ค่ะ" · red pill "ลองใหม่" |
| **points error only** | `/api/me` fails, videos OK | list works; badge shows `⭐ –`; PointsSummary hidden | – (no alert for a non-blocking failure) |

---

## 4. Public — `/watch/[videoId]` (WatchPage)

Data: `POST /api/sessions {videoId}` → `sessionId, state, positionSec, furthestSec, lastSeq, isReplay, alreadyRewarded,
currentQuestionId, passedQuestionIds, video{…, channelName, durationSec, rewardPoints}, quizzes[]` · `GET /api/me`.
Writes (single queue): `/events`, `/answer`, `/claim`. Reducer states (plan §8):
`loading → ready → playing ⇄ paused → quiz_open(q) → [wrong] → paused → playing → ended → claiming → rewarded`
+ `replay` + `error`. Server `state` in every response is the truth; UI reconciles to it.

### 4.1 Layout
```
≤ 600                                              ≥ 1025 (max-width 880, centred)
┌─────────────────────────────────┐                ┌──────────────────────────────────────────────┐
│ Header  ←  ดูคลิป รับแต้ม [⭐ 50] │                │ Header                            [⭐ 50 แต้ม] │
├─────────────────────────────────┤                ├──────────────────────────────────────────────┤
│ ContextBanner (replay/resume/    │                │ ← กลับไปหน้ารวมคลิป (text link)                 │
│   reward) — only when relevant   │                │ Title (h1, 2 lines) · วิดีโอจาก YouTube: ch    │
├─────────────────────────────────┤                │ ContextBanner                                 │
│ VideoPlayer 16:9 (edge-to-edge   │                │ VideoPlayer 16:9, radius 20                   │
│  inside 16px gutter, radius 14)  │                │ ControlBar                                    │
│  [shield] centre ▶ when paused   │                │ StatusLine                                    │
│ ControlBar 56px                  │                │ QuizProgress: ◆ คำถามที่ 1 · 0:13  ✓/○          │
│ [▶ 48] 0:13 / 0:44 ▓▓▓◆░░░░░     │                │ HowItWorks (3 steps in a row)                 │
│ StatusLine (aria-live)           │                └──────────────────────────────────────────────┘
│ Title (h1 20px) + source line    │
│ HowItWorks ① ② ③ (stacked)       │
└─────────────────────────────────┘
```
On ≤ 600 the title sits **below** the controls so the video is visible without scrolling on a 360×640 screen
(header 56 + player 184 + controls 56 = 296px).

### 4.2 Player behaviour (visual side of plan §6)
- iframe `playerVars` per plan §6; `title="วิดีโอ: {video.title}"`; `allow="autoplay; encrypted-media"`; `playsinline`.
- **Click shield** (transparent layer over the iframe) → our toggle handler; YouTube's own UI is never reachable.
  Plan §6 notes a tap on the iframe can toggle on mobile; the shield routes it through our handler so the reducer
  stays in sync.
- No seek bar, no speed/fullscreen/captions buttons. Volume via device only.
- Centre ▶ (64px circle, `--scrim`, decorative) on `ready`/`paused`/`replay-ended`.

### 4.3 Components

#### 4.3.1 PointsBadge (header, every state, both pages)
Pill, `--warning-bg`/`--warning` text (6.37), ⭐ + `{totalPoints}` + " แต้ม" (≤ 360px: number only + sr-only "แต้ม"),
height 32 (not interactive). Wrapper `role="status"`, `aria-label="แต้มสะสม {n} แต้ม"`.
States: **loading** skeleton 72×32 · **normal** · **increment** (count-up over 600ms + one pulse 1→1.08→1; reduced
motion: instant) · **unavailable** `⭐ –` (+ sr-only "ไม่สามารถโหลดแต้มได้").
On `/watch/*` it starts from `/api/me` and is replaced by `totalPoints` from `/claim`.

#### 4.3.2 ControlBar
- Play/Pause: 48×48 red pill (`--brand-accent`, white icon, `--shadow-cta`); label swaps "เล่นวิดีโอ" / "หยุดชั่วคราว".
  Disabled (`aria-disabled`, 40% opacity, no shadow) in `loading`, `quiz_open`, `ended`, `claiming`.
- Time: `{current m:ss} / {duration m:ss}` 14px `--text-muted`, tabular-nums.
- **WatchProgress (read-only)**: 8px bar, radius pill, track `--track`, fill `--brand-primary` = `positionSec/duration`,
  plus a lighter band `#1D379333` up to `furthestSec` (shows "watched ground").
  `role="progressbar"`, `aria-valuemin 0`, `aria-valuemax {durationSec}`, `aria-valuenow {current}`,
  `aria-valuetext="ดูไปแล้ว {m:ss} จาก {m:ss}"`. Not focusable, no thumb, no pointer handlers, `cursor:default`.
- **Quiz markers** (one per `quizzes[]` at `triggerSec/durationSec`): 12px diamond. Unpassed `--brand-accent`
  (4.13 vs track); passed (`passedQuestionIds`) → 14px circle `--success` with white ✓. `aria-hidden` (QuizProgress
  says it in words).

#### 4.3.3 StatusLine
One line under the ControlBar, 14px `--text-2` with a leading icon, `aria-live="polite"`. Copy per state in §4.4.

#### 4.3.4 QuizProgress (≥ 601 inline row, ≤ 600 collapsed into StatusLine)
Chips "คำถามที่ {i} · {m:ss}" with ○ (pending) / ✓ (passed, success colour). Hidden when `quizzes.length === 0`.

#### 4.3.5 QuizModal
- ≤ 600: bottom sheet (radius 20 top, max-height 85vh, internal scroll, safe-area padding). ≥ 601: centred dialog,
  max-width 520px, radius 20, `--shadow-modal`. Backdrop `--scrim`; background `inert`.
- `role="dialog" aria-modal="true" aria-labelledby="quiz-title" aria-describedby="quiz-prompt"`.
  **No close button; Esc and backdrop tap do nothing** (answer required). Helper line explains why.
- Content: eyebrow `คำถามที่ {i} จาก {n}` (13px `--text-muted`) · title **"ตอบคำถามก่อนดูต่อนะคะ"** (20px Bold
  `--brand-primary-dark`, `id=quiz-title`, receives focus on open) · prompt `{q.prompt}` (18px, `id=quiz-prompt`) ·
  2–4 **ChoiceButtons** · FeedbackArea (`aria-live="assertive"`) · helper "วิดีโอจะเล่นต่อเมื่อตอบถูกค่ะ" (13px).
- **ChoiceButton**: full width, min-height 56px, radius 16, 1.5px `--border-control` border, white bg, 16px text;
  left: 32px circle with `{label}`; `aria-label="ตัวเลือก {label}: {text}"`. One tap = submit (no separate confirm).

| Choice / modal sub-state | Visual | Behaviour | Copy (FeedbackArea) |
|---|---|---|---|
| **syncing** (gate TICK in flight; plan §6: answer only after response `state = QUIZ_PENDING`) | all choices `aria-disabled`, 60% opacity; small spinner beside the eyebrow | taps ignored | sr + visible 13px: "กำลังเตรียมคำถาม…" |
| **ready** | default | tappable | – |
| hover / focus | border `--brand-primary`, focus ring | – | – |
| **submitting** | tapped choice: spinner replaces label circle; all choices `aria-disabled`, `aria-busy` on the list | waits for `/answer` | – |
| **wrong** (`correct:false`) | that choice: `--danger-bg`, 1.5px `--danger` border, ✕ icon, `aria-disabled="true"` + sr " (ตอบแล้ว ไม่ถูก)"; **stays disabled for this question**; others re-enabled; shake 300ms (not in reduced motion) | focus moves to the first enabled choice | ✕ "ยังไม่ถูกนะคะ ลองเลือกข้ออื่นดูอีกครั้งค่ะ" (`--danger`) |
| **correct** | choice: `--success-bg`, `--success` border, ✓; others disabled | after 900ms modal closes → reducer `paused` → client sends PLAY → `playing`; focus returns to Play/Pause | ✓ "ถูกต้องค่ะ! เก่งมาก ดูต่อได้เลยนะคะ" (`--success`) |
| **answer network/5xx** | tapped choice returns to default (not marked wrong) | re-enabled | "ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ" |
| **400 INVALID_CHOICE** | same as network (should not happen) | reload quiz from session | "เกิดข้อผิดพลาด กรุณาลองใหม่ค่ะ" |

- If only one enabled choice remains, it stays tappable (no auto-answer).
- On resume with server `state = QUIZ_PENDING` (`currentQuestionId` set): modal opens right after the player is ready,
  **directly in `ready`** (server is already pending, no syncing step); choices already tried are not known to the
  client → all enabled.

#### 4.3.6 Toast (`shared/ui/Toast`)
Bottom-centre above the ControlBar (≤ 600: full width minus gutter), radius 12, `--brand-primary-dark` bg, white text
14px (13.67:1), icon, auto-hide 3s (errors 5s), max one visible, `role="status"`. Rate-limit identical toasts to 1 / 5s.

#### 4.3.7 ContextBanner (above the player)
Radius 16, padding 12/16, icon + text, `role="status"` on first render only. Variants in §4.4 (resume, replay).

#### 4.3.8 RewardCard ("ยินดีด้วย +50 Points") — reference C6
- Replaces the ContextBanner position (above the player) and scrolls into view (`scrollIntoView({block:'nearest'})`;
  focus is **not** moved; the badge + card are announced via `role="status"`).
- Background `linear-gradient(135deg, #1A2A5E 0%, #2B4BB5 100%)`, radius 24 (20 ≤ 600), padding 24/32,
  `--shadow-modal`, white text, centred.
- Row 1: ⭐ (28px `--gold`) + "ยินดีด้วยค่ะ!" 20px Bold.
- Row 2: **"+{points}"** `--fs-score` Bold `--gold` + " Points" 24px white (reads "ยินดีด้วย +50 Points").
- Row 3 (glass box, reference C7, no italic): "คุณดูคลิปจบและตอบคำถามถูกครบแล้ว แต้มสะสมทั้งหมด {totalPoints} แต้มค่ะ"
  on `#FFFFFF1A` with 1px `#FFFFFF33` border, radius 16, 16px.
- Actions (white on navy → **no red buttons here**): outline-white pill "ดูทบทวนอีกครั้ง" (44px) · white-filled pill
  with navy text "ดูคลิปอื่น" → `/` (always shown: the watch page does not know how many videos are published).
- Entrance: slideUp 0.5s + 24 confetti particles 1s (reduced motion: fade 150ms, no confetti).
- sr text: "ยินดีด้วยค่ะ ได้รับ {points} แต้ม แต้มสะสมทั้งหมด {totalPoints} แต้ม".

#### 4.3.9 InlineNotice / ErrorState (`shared/ui`)
InlineNotice: radius 12, `--danger-bg` (or `--warning-bg`/`--info-bg`), icon + text + optional button, under the player.
ErrorState: replaces the player box (keeps 16:9 so nothing jumps), `--surface`, centred icon (48px, `--danger`),
title 18px Bold, body 14px `--text-2`, red pill action (48px). `role="alert"`.

### 4.4 State × UI matrix (plan §8 + server sub-cases)
| # | Reducer state | Trigger | Player / centre ▶ | Play btn | Progress | Overlay | Banner / notice | StatusLine copy |
|---|---|---|---|---|---|---|---|---|
| 1 | `loading` | page open | skeleton 16:9 | disabled skeleton | skeleton | – | – | "กำลังโหลดวิดีโอ…" (+ after 8s: "ใช้เวลานานกว่าปกติ ลองตรวจสอบอินเทอร์เน็ตนะคะ") |
| 2 | `ready` (new) | session `CREATED`, `positionSec 0`, not replay | poster + ▶ | ▶ enabled | 0 | – | – | "ดูคลิปให้จบและตอบคำถาม {n} ข้อ เพื่อรับ {rewardPoints} แต้มนะคะ" |
| 3 | `ready` (resumed) | session resumed (`PAUSED`, `positionSec > 0`) | frame at `positionSec` + ▶ | ▶ | at `positionSec`, band to `furthestSec`, passed markers ✓ | – | info: "ดูต่อจาก {m:ss} ที่ค้างไว้นะคะ" | "กดเล่นเพื่อดูต่อได้เลยค่ะ" |
| 4 | `ready` → `quiz_open` (resumed pending) | session `QUIZ_PENDING` | frame at trigger, scrim | disabled | at trigger | QuizModal (ready) | – | – |
| 5 | `ready` → `claiming` (resumed ended) | session `ENDED`, not rewarded → auto-claim | last frame | disabled | 100% | – | – | "ดูจบแล้ว กำลังบันทึกแต้มให้นะคะ…" |
| 6 | `playing` | PLAY | video | ❚❚ | moving | – | – | before next quiz: "คำถามถัดไปจะขึ้นที่ {m:ss} นะคะ" · all passed: "ตอบครบแล้ว ดูต่อให้จบเพื่อรับแต้มค่ะ" · no quizzes: "ดูให้จบเพื่อรับแต้มค่ะ" |
| 7 | `paused` | user pause | frame + ▶ | ▶ | frozen | – | – | "หยุดชั่วคราว กดเล่นเพื่อดูต่อค่ะ" |
| 8 | `paused` (tab hidden) | `visibilitychange: hidden` | frame + ▶ | ▶ | frozen | – | – | "หยุดไว้ให้ระหว่างที่คุณออกจากหน้านี้ค่ะ" |
| 9 | `quiz_open(q)` syncing | client gate hit (`current ≥ triggerSec`) → pause + TICK | frozen under scrim | disabled | at trigger | QuizModal (syncing) | – | – |
| 10 | `quiz_open(q)` | response `state = QUIZ_PENDING` | same | same | same | QuizModal (ready) | – | – |
| 11 | `quiz_open(q)` + error | `correct:false` | same | same | same | wrong choice disabled + feedback | – | – |
| 12 | **gate fallback** | gate response `state ≠ QUIZ_PENDING` (e.g. `SPEED_EXCEEDED`) **or** `/answer` 409 NOT_AT_QUIZ | modal closes (slide down 200ms); `seekTo(positionSec)` | ▶ → continues per plan (resends PLAY) | jumps to server `positionSec` | – | Toast: "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ" | back to row 6 copy |
| 13 | `paused` → `playing` | correct answer → PAUSED → PLAY | resumes | ❚❚ | marker ✓ | modal closed | – | row 6 copy |
| 14 | **resync** | 409 SEQ_CONFLICT or rejected progress (`SEEK_FORWARD`/`SPEED_EXCEEDED`/`BATCH_ABORTED`) | `seekTo(positionSec)`; keeps play/pause per server state | per server | jumps back | – | Toast only if the jump ≥ 2s: "ข้ามช่วงวิดีโอไม่ได้นะคะ ขอพากลับไปจุดที่ดูถึงค่ะ"; silent otherwise | unchanged |
| 15 | client seek guard | rAF: `current > furthest + 1.5` → `seekTo(furthest)` | snaps back | – | – | – | same Toast as 14 (rate-limited) | – |
| 16 | `ended` | YouTube `ENDED` → ENDED event queued | last frame | disabled | 100% | – | – | "ดูจบแล้ว กำลังตรวจสอบค่ะ…" |
| 17 | **ENDED fallback** | ENDED result `rejectReason = NOT_WATCHED` | seek to `max(0, furthestSec − (0.9×duration − playedWallSec))` and **keeps playing** | ❚❚ | jumps back | – | InlineNotice (info): "ดูต่ออีกนิดนะคะ ระบบยังนับเวลาดูไม่ครบ" (stays until the next `ended`) | "ดูต่ออีกนิดนะคะ" |
| 18 | `claiming` | ENDED accepted → auto `POST /claim` | last frame | disabled | 100%, all ✓ | – | – | spinner + "กำลังบันทึกแต้มให้นะคะ…" |
| 19 | `rewarded` | `/claim` → `awarded:true` | last frame + ▶ ("ดูทบทวน") | ▶ | 100% | – | **RewardCard** + PointsBadge count-up | – |
| 20 | `replay` (start) | session `isReplay:true` (or `alreadyRewarded:true`) | normal | ▶ | normal | quizzes still shown (plan §8) | ContextBanner info-bg: "คลิปนี้คุณได้รับแต้มไปแล้วค่ะ ดูทบทวนและลองตอบคำถามได้ แต่จะไม่ได้แต้มเพิ่มนะคะ" | row 2 copy without the points clause: "ดูทบทวนและตอบคำถาม {n} ข้อได้เลยค่ะ" |
| 21 | `replay` (end) | `/claim` → `awarded:false` | last frame + ▶ | ▶ | 100% | – | InlineNotice info: "ดูทบทวนจบแล้วค่ะ 👏" + outline pill "ดูอีกครั้ง" + link "ดูคลิปอื่น" | – |
| 22 | `error` | see §4.5 | ErrorState | hidden | hidden | – | – | – |
| 23 | offline | `navigator.onLine=false` while watching | unchanged | unchanged | unchanged | – | Toast (sticky until online): "ขาดการเชื่อมต่อ ความคืบหน้าอาจยังไม่ถูกบันทึกนะคะ" | – |

Notes:
- "ดูทบทวน" from `rewarded`/`replay` = new `POST /api/sessions` (server creates/resumes an `isReplay` session, plan §4.3);
  the page goes `loading` (player keeps its frame, only ControlBar shows a spinner) → row 20.
- Row 12 and 14 never show an error style: honest users on bad networks are the common case (plan §8).

### 4.5 Error map (`/watch/*`)
| Source | Where | Title / message | Action |
|---|---|---|---|
| `POST /sessions` 404 `VIDEO_NOT_FOUND` | ErrorState | "ไม่พบคลิปนี้ค่ะ" · "คลิปอาจถูกนำออกหรือยังไม่เปิดให้ดู" | red pill "กลับหน้ารวมคลิป" → `/` |
| `POST /sessions` network/5xx | ErrorState | "โหลดวิดีโอไม่สำเร็จ" · "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ค่ะ" | "ลองใหม่" |
| YouTube `onError` / IFrame API script fails | ErrorState | "เล่นวิดีโอนี้ไม่ได้ในขณะนี้ค่ะ" · "ลองใหม่อีกครั้ง หรือกลับไปเลือกคลิปอื่นนะคะ" | "ลองใหม่" (re-create player) + link "กลับหน้ารวมคลิป" |
| any write 403 `NOT_OWNER` | ErrorState | "เซสชันนี้ไม่ใช่ของคุณ" · "กรุณาโหลดหน้าใหม่เพื่อดูต่อค่ะ" | "โหลดหน้าใหม่" |
| `/events` 429 `EVENT_LIMIT` | ErrorState | "มีการส่งข้อมูลมากผิดปกติ" · "กรุณาโหลดหน้าใหม่แล้วดูต่อค่ะ" | "โหลดหน้าใหม่" |
| `/events` 409 `SEQ_CONFLICT` | not an error → row 14 | – | – |
| `/events` network/5xx | silent retry (queue keeps events, backoff 1s/2s/4s); after 3 fails → row 23 toast | – | – |
| `/answer` 409 `NOT_AT_QUIZ` | row 12 | – | – |
| `/claim` 422 `NOT_ENDED` | not a page error → resync; treat as row 17 (keep watching) | InlineNotice "ดูต่ออีกนิดนะคะ" | – |
| `/claim` network/5xx | InlineNotice (danger) under player | "บันทึกแต้มไม่สำเร็จค่ะ" | red pill "ลองบันทึกอีกครั้ง" (claim is idempotent) |
| 413 / 400 `VALIDATION_ERROR` | ErrorState (bug path) | "เกิดข้อผิดพลาด" · "กรุณาโหลดหน้าใหม่ค่ะ" | "โหลดหน้าใหม่" |

---

## 5. Backoffice `/admin/*`

Desktop-first (designed at 1280), must stay usable at 390: tables turn into stacked cards ≤ 600, forms go single
column, every control ≥ 44px. Background `--bg-admin`. Buttons: primary action = navy filled pill
(`--brand-primary`, white 10.4) — **red is reserved for destructive actions in admin** (archive/delete) so "press this"
and "danger" do not collide; secondary = outline pill (`--border-control`, navy text).

### 5.1 `/admin/login` — `AdminLoginPage`
```
┌─────────────── --bg-admin ───────────────┐
│        ดูคลิป รับแต้ม · ผู้ดูแลระบบ          │
│   ┌───────────── card 400px ───────────┐ │   ≤ 600: card full width, 16px gutter, radius 16
│   │ เข้าสู่ระบบผู้ดูแล (h1 24px)          │ │
│   │ [notice area]                      │ │
│   │ อีเมล        [                    ] │ │   input 48px, radius 12, border --border-control
│   │ รหัสผ่าน     [               ] [👁] │ │   show/hide toggle 44×44, aria-pressed
│   │ [        เข้าสู่ระบบ (navy)        ] │ │   48px full width
│   └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```
`<form>` with `autocomplete="username"` / `"current-password"`, labels visible (not placeholders), Enter submits.

| State | Visual | Copy |
|---|---|---|
| default | as above, button enabled when both fields non-empty | – |
| client validation | field border `--danger` + message under field, `aria-invalid`, `aria-describedby` | "กรุณากรอกอีเมล" · "รูปแบบอีเมลไม่ถูกต้อง" · "กรุณากรอกรหัสผ่าน" |
| submitting | button spinner + "กำลังเข้าสู่ระบบ…", fields read-only | – |
| **401 INVALID_CREDENTIALS** | notice (danger) at top of card, `role="alert"`; password cleared + focused; email kept | "อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ" (never says which one) |
| **429 TOO_MANY_ATTEMPTS** | notice (warning) with clock icon; button disabled **until the user edits a field** (no timer — the API gives no retry-after) | "ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ (อาจต้องรอถึง 15 นาที)" |
| 403 BAD_ORIGIN | notice danger | "คำขอไม่ถูกต้อง กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้งค่ะ" |
| network/5xx | notice danger | "เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่ค่ะ" |
| `?reason=expired` | notice info on load | "หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้งค่ะ" |
| `?reason=logout` | notice success on load | "ออกจากระบบเรียบร้อยแล้วค่ะ" |
| success | redirect `/admin` (or `?next=` path when it starts with `/admin`) | – |

### 5.2 `/admin` — Dashboard (`AdminDashboardPage`)
- Title "แดชบอร์ด". **StatTiles** grid: 4 cols ≥ 1025 · 2 cols 601–1024 · 2 cols ≤ 600 (tile min-height 96).
  Tiles (plan §1): **ยอดเข้าชม** (views) · **ดูจบ/รับแต้ม** (completions) · **แต้มที่แจกไป** (points awarded) ·
  **เซสชันที่ถูกแจ้งเตือน** (flagged). `GET /api/admin/stats?videoId` → `{ views, completions, pointsAwarded, flaggedSessions }`
  (views = non-replay sessions, completions = ledger rows). Tile tooltips/sub-labels: ยอดเข้าชม "ไม่รวมการดูทบทวน" ·
  ดูจบ/รับแต้ม "จำนวนครั้งที่ได้แต้ม".
- Video filter above the tiles: Select "ทุกวิดีโอ" + titles → `?videoId` (48px; reflected in the URL).
- Tile: white, radius 16, padding 16/20, label 14px `--text-2`, value 32px Bold `--brand-primary-dark`, icon 24px
  top-right. **Flagged tile**: `--warning-bg` + 4px `--warning` left border when value > 0; the whole tile is a link to
  `/admin/sessions?flagged=true` (44px+ target, `aria-label="ดูเซสชันที่ถูกแจ้งเตือน {n} รายการ"`).
- Below: "เซสชันที่ถูกแจ้งเตือนล่าสุด" = SessionTable (§5.6) limited to 5 rows, from `/api/admin/sessions?flagged=true`,
  + link "ดูทั้งหมด →".
- States: loading (tile skeletons) · empty data (all 0: tiles show 0; flagged table EmptyState "ยังไม่มีเซสชันที่ถูกแจ้งเตือนค่ะ 🎉") ·
  error (InlineNotice + "ลองใหม่"; each block fails independently).

### 5.3 `/admin/videos` — Video list (`AdminVideoListPage`)
- Title "วิดีโอ" + primary "เพิ่มวิดีโอ" (`+`) → `/admin/videos/new`.
- Filter tabs (segmented, 44px): ทั้งหมด · เผยแพร่แล้ว · ฉบับร่าง · เก็บถาวร (client-side filter on `status`; the list is
  requested with `pageSize=100` so the filter covers every video in practice; Pagination below if `total > pageSize`).
- **VideoTable** (≥ 601) columns: thumbnail 96×54 · ชื่อคลิป (+ channel 13px muted) · สถานะ (StatusBadge) ·
  แนะนำ (★ navy when `isFeatured`) · ความยาว `m:ss` (`durationSec`) · คำถาม (`questionCount`) · แต้ม (`rewardPoints`) ·
  ผู้ชม (`sessionCount`) · 🔒 when `locked` (icon + sr "ล็อกแล้ว") · actions (kebab menu 44×44).
  ≤ 600: each row = card (thumb left 96px, title, badges row, kebab).
- **StatusBadge**: `published` → success "เผยแพร่แล้ว" · `draft` → warning "ฉบับร่าง" · `archived` → surface-2 +
  `--text-2` "เก็บถาวร". Text always present (not colour-only).
- Row actions (menu): แก้ไข · เผยแพร่ (draft) · ตั้งเป็นคลิปแนะนำ (published & not featured) · เก็บถาวร (red text, confirm).
  - Publish/feature: optimistic disabled row + spinner → Toast "เผยแพร่แล้วค่ะ" / "ตั้งเป็นคลิปแนะนำแล้วค่ะ (คลิปแนะนำเดิมถูกยกเลิก)".
  - Archive confirm Modal: title "เก็บคลิปนี้ถาวร?" · body "ผู้ชมใหม่จะไม่เห็นคลิปนี้ ผู้ที่เริ่มดูไว้แล้วยังดูต่อและรับแต้มได้ค่ะ" ·
    buttons "ยกเลิก" (outline) · "เก็บถาวร" (red).
- States: loading (5 skeleton rows) · empty "ยังไม่มีวิดีโอค่ะ เริ่มเพิ่มคลิปแรกกันเลย" + primary "เพิ่มวิดีโอ" ·
  empty filter "ไม่มีวิดีโอในสถานะนี้" · error InlineNotice + retry.

### 5.4 `/admin/videos/new` and `/admin/videos/[id]` — Video form + preview + quiz editor

#### Layout
```
≥ 1025                                                         ≤ 600
┌──────────────────────────────┬────────────────────────────┐  ┌──────────────────────────┐
│ ← วิดีโอ / แก้ไขวิดีโอ   [StatusBadge] [เผยแพร่] [⋯]         │  │ ← แก้ไขวิดีโอ   [badge][⋯] │
├──────────────────────────────┬────────────────────────────┤  │ YouTubePreview 16:9       │
│ YouTubePreview (sticky top)  │ VideoDetailsForm (card)    │  │ ⏱ 0:13.4 / 0:44  (live)   │
│ 16:9, admin controls ON      │  ลิงก์ YouTube 🔒          │  │ VideoDetailsForm           │
│ ⏱ เวลาปัจจุบัน 0:13.4 / 0:44  │  ชื่อคลิป                   │  │ LockNotice                │
│ (live readout, tabular)      │  ช่อง (read-only)           │  │ QuizEditor                │
│                              │  ความยาว 🔒 (from preview)   │  │ (sticky mini time bar at  │
│ LockNotice (when locked)     │  แต้มที่ได้รับ               │  │  bottom: ⏱ 0:13.4 [▶/❚❚]) │
│                              │ QuizEditor (card)          │  └──────────────────────────┘
└──────────────────────────────┴────────────────────────────┘
  columns 5fr / 7fr, gap 24
```
≤ 600: the preview is not sticky (it would eat 220px); instead a **sticky bottom time bar** (56px, white, top shadow)
shows `⏱ {current}` + a 44px play/pause for the preview, so "ใช้เวลาปัจจุบัน" is always meaningful.

#### YouTubePreview (`admin/components/YouTubePreview`)
- IFrame Player with **normal YouTube controls** (admins may seek), 16:9, radius 14.
- Live readout under it: "เวลาปัจจุบัน {m:ss.s} / {m:ss}" (one decimal, tabular-nums), `aria-live="off"` (too chatty);
  a button "อ่านเวลาให้ฟัง" is unnecessary — the "ใช้เวลาปัจจุบัน" action announces the value it inserted.
- States: **empty** (no URL yet) → surface-2 box "วางลิงก์ YouTube เพื่อดูตัวอย่าง" · **loading** → skeleton ·
  **ready** → player + readout · **error** (invalid id / not embeddable / player error) → danger box
  "เล่นตัวอย่างไม่ได้ ตรวจสอบว่าลิงก์ถูกต้องและคลิปอนุญาตให้ฝัง (embed) ค่ะ".

#### VideoDetailsForm
| Field | Create (`/new`) | Edit | Rules / copy |
|---|---|---|---|
| ลิงก์ YouTube (`youtubeUrl`) | text input, paste → preview loads on blur/paste | shows the URL; **🔒 disabled when locked** | helper "วางลิงก์ เช่น https://youtu.be/…" · error "ลิงก์ YouTube ไม่ถูกต้อง" |
| ชื่อคลิป (`title`) | optional | editable (never locked) | helper (create) "เว้นว่างไว้เพื่อใช้ชื่อจาก YouTube" |
| ช่อง (`channelName`) | not shown before save | read-only text "จาก YouTube: {channelName}" | filled by server (oEmbed) |
| ความยาว (`durationSec`) | read-only field auto-filled from the preview's `getDuration()` ("ดึงจากตัวอย่างอัตโนมัติ"); save disabled until > 0 | **🔒 when locked** | error "ยังอ่านความยาวคลิปไม่ได้ กรุณารอตัวอย่างโหลดเสร็จค่ะ" |
| แต้มที่ได้รับ (`rewardPoints`) | number, default 50, stepper not needed | editable (never locked) | integer 1–1000 (plan §4.5) · error "แต้มต้องเป็นจำนวนเต็ม 1–1,000" |
- Actions: create → navy "บันทึกและเพิ่มคำถาม" → redirects to `/admin/videos/{id}` with Toast "บันทึกวิดีโอแล้วค่ะ".
  Edit → "บันทึกการแก้ไข" (enabled only when dirty); leaving with unsaved changes → confirm Modal
  "มีการแก้ไขที่ยังไม่บันทึก ออกจากหน้านี้เลยไหมคะ?".
- Header actions (edit): StatusBadge · "เผยแพร่" (draft) · "ตั้งเป็นคลิปแนะนำ" / "★ คลิปแนะนำ" (read-only badge when
  already featured) · kebab → "เก็บถาวร" (red, confirm as §5.3).
- Save states: saving (button spinner) · saved (Toast) · 400 VALIDATION_ERROR (field errors under fields, first
  invalid field focused) · **409 VIDEO_LOCKED** (race: lock happened after load) → LockNotice appears, locked fields
  switch to disabled, value reverts, Toast danger "บางช่องถูกล็อกแล้ว เพราะมีผู้ชมเริ่มดูคลิปนี้ค่ะ" ·
  401 → login redirect · 403 BAD_ORIGIN → InlineNotice "คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่ค่ะ".

#### Locked video (plan §7) — `LockNotice` + disabled fields
- Shown when `locked === true` (admin video detail; `locked = sessionCount > 0`, plan §4.5), so fields are disabled on
  load. The 409 VIDEO_LOCKED handling above remains for the race where the first viewer starts after the page loaded.
  LockNotice also shows the count: "ผู้ชม {sessionCount} เซสชัน".
- LockNotice: `--warning-bg`, 4px `--warning` left border, 🔒, "คลิปนี้มีผู้ชมเริ่มดูแล้ว จึงล็อกลิงก์ ความยาว
  เวลาของคำถาม และเฉลยไว้ค่ะ แก้ได้เฉพาะข้อความ ชื่อคลิป แต้ม และคลิปแนะนำ".
- **Locked field style:** `--surface-2` bg, `--text-2` text (6.9:1, stays readable), 🔒 icon inside the field (right),
  `aria-disabled="true"` + `readonly` (not `disabled`, so it stays focusable and screen readers hear the value) +
  `aria-describedby` → LockNotice. Locked buttons ("ใช้เวลาปัจจุบัน", "เพิ่มคำถาม", "ลบคำถาม", add/remove choice) are
  `aria-disabled` with a visible 13px reason on focus/hover ("ล็อกแล้ว").
- Locked set: `youtubeUrl`, `durationSec`, each question's `triggerSec` and correct-choice radio, add/delete question,
  **add/remove choice** (labels drive `correctChoice`; confirmed plan §4.5).
  Editable: title, rewardPoints, featured, question prompt text, choice text.

#### QuizEditor (`admin/components/QuizEditor`)
- Card "คำถามในคลิป ({n})" + button "+ เพิ่มคำถาม" (outline; 🔒 when locked; disabled on `/new` until the video is saved:
  helper "บันทึกวิดีโอก่อนจึงเพิ่มคำถามได้ค่ะ").
- Questions listed by ascending `triggerSec`. Each = **QuestionCard**, collapsed summary row (48px, button,
  `aria-expanded`): "⏱ {m:ss} · {prompt 1 line} · {k} ตัวเลือก · เฉลย {label}". Expanded:

```
┌ QuestionCard ────────────────────────────────────────────────┐
│ เวลาที่คำถามขึ้น                                                │
│ [ 0:13.0 ]  [⏱ ใช้เวลาปัจจุบัน]  [▶ ไปที่เวลานี้]                  │  input m:ss.s 48px; buttons 44px outline
│ helper: ต้องมากกว่า 0:00 และน้อยกว่า {duration−2 m:ss}           │
│ คำถาม                                                         │
│ [ textarea, 3 rows, max 300 chars, counter 0/300 ]           │
│ ตัวเลือก (2–4 ข้อ) — เลือกข้อที่ถูก                                 │
│ (●) A [ text …………………………… ] [🗑]                                │  radio 44×44 hit area; label "เฉลย"
│ ( ) B [ text …………………………… ] [🗑]                                │
│ [+ เพิ่มตัวเลือก] (hidden at 4)                                   │
│                        [ลบคำถาม] (red text)   [บันทึกคำถาม] (navy) │
└───────────────────────────────────────────────────────────────┘
```
- **"ใช้เวลาปัจจุบัน"**: reads `getCurrentTime()` from YouTubePreview, rounds to 0.1s, fills the field, flashes the
  field (bg `--info-bg` 600ms), announces via `aria-live="polite"`: "ตั้งเวลาเป็น {m:ss.s} แล้วค่ะ".
  Disabled when the preview is not ready ("รอตัวอย่างโหลดก่อนค่ะ") or when locked.
- **"ไปที่เวลานี้"**: `seekTo(triggerSec)` + pause on the preview (lets the admin check the frame).
- Validation (client mirrors plan §7; server 422 `INVALID_TRIGGER` shows the same message under the field):
  "เวลาต้องมากกว่า 0:00 และน้อยกว่า {m:ss}" · duplicate trigger in this video → "มีคำถามที่เวลานี้แล้ว เลือกเวลาอื่นค่ะ"
  (client check + server 409 `DUPLICATE_TRIGGER`, shown under the time field) · empty prompt "กรุณากรอกคำถาม" · < 2 choices → add-choice
  prompt · empty choice text "กรุณากรอกตัวเลือก" · no correct selected "เลือกข้อที่ถูกต้อง 1 ข้อ".
- States per card: collapsed · expanded · dirty (dot "ยังไม่บันทึก" on the summary row) · saving · saved (Toast
  "บันทึกคำถามแล้วค่ะ") · error (field errors) · locked (as above) · new (unsaved, opens expanded, scrolls into view,
  trigger pre-filled with the preview's current time when the preview is ready).
- Delete: confirm Modal "ลบคำถามนี้?" · "ลบแล้วกู้คืนไม่ได้ค่ะ" · "ยกเลิก" / "ลบคำถาม" (red).
- Empty: "ยังไม่มีคำถามในคลิปนี้ค่ะ" + hint "เล่นตัวอย่างไปยังจุดที่ต้องการ แล้วกด “เพิ่มคำถาม”".
  (Publishing with 0 questions is allowed — plan §4.5; the UI shows a warning notice next to
  "เผยแพร่" when `questionCount` = 0: "คลิปนี้ยังไม่มีคำถาม ผู้ชมจะรับแต้มได้โดยไม่ต้องตอบคำถามค่ะ".)

### 5.5 `/admin/users` and `/admin/users/[id]`
Anonymous learners (signed cookie UUID) → identify by short id.
- **List** (`UserTable`): columns ผู้ใช้ (`{id first 8}…`, monospace 14px, full id in `title` + copy button 44×44
  "คัดลอก") · เริ่มใช้งาน (`createdAt`) · แต้มสะสม (`totalPoints`) · จำนวนเซสชัน (`sessionCount`) · ใช้งานล่าสุด
  (`lastActiveAt`). Items from `GET /api/admin/users?page&pageSize` → `{ items, page, pageSize, total }` (plan §4.5).
  No sort controls (the API defines no sort param). **Pagination** (§5.8).
  ≤ 600: card per user (id, points big, sessions/created on one meta line).
  States: loading · empty "ยังไม่มีผู้ใช้ค่ะ" · error + retry.
- **Detail** `/admin/users/[id]` → `{ user:{ id, createdAt, totalPoints }, ledger:[{ sessionId, videoId, videoTitle, points, createdAt }],
  sessions:[SessionRow] }`: header "ผู้ใช้ {short id}" + copy full id + "เริ่มใช้งาน {createdAt}" · StatTiles (แต้มสะสม =
  `user.totalPoints`, คลิปที่ได้แต้ม = `ledger.length`, เซสชันทั้งหมด = `sessions.length`, 🚩 = sessions with `flagged`) ·
  "ประวัติแต้ม" table (วันที่ `createdAt` · คลิป `videoTitle` → link `/admin/videos/{videoId}` · แต้ม `+{points}` success ·
  เซสชัน → link "ดูเซสชัน" `/admin/sessions/{sessionId}` (44px row target);
  empty: "ยังไม่ได้รับแต้มค่ะ") · "เซสชัน" = SessionTable of `sessions` (not paged). 404 → EmptyState "ไม่พบผู้ใช้นี้ค่ะ" + back link.

### 5.6 `/admin/sessions` — list (`AdminSessionListPage`)
- Filters bar: video select ("ทุกวิดีโอ" + titles; maps to `?videoId`) · toggle "เฉพาะที่ถูกแจ้งเตือน 🚩"
  (switch, 44px, maps to `?flagged=true`) — both reflected in the URL so links from the dashboard work.
- **SessionTable** columns: 🚩 (flag icon + sr "ถูกแจ้งเตือน") · เริ่ม (`startedAt`) · ผู้ใช้ (short id link) · วิดีโอ ·
  สถานะ (`SessionStateBadge`) · ดูถึง `{furthest m:ss} / {duration m:ss}` with mini bar 48px · ประเภท (`รอบแรก`/`ดูทบทวน`
  from `isReplay`) · เวลาเล่นจริง (`playedWallSec` m:ss) · แต้ม (`pointsAwarded` > 0 → `+{pointsAwarded}` success, else `–`).
  Row = SessionRow `{ id, userId, videoId, videoTitle, state, flagged, isReplay, furthestSec, durationSec, playedWallSec,
  pointsAwarded, startedAt, endedAt }` (plan §4.5); user cell = `userId` short id → `/admin/users/{userId}`; video cell =
  `videoTitle`. Row is a link to `/admin/sessions/{id}`. Paged: `?videoId&flagged&page&pageSize` → **Pagination** (§5.8).
- **Flagged row**: `--warning-bg` background + 4px `--warning` left border + 🚩 (colour + icon + sr text).
- **SessionStateBadge**: CREATED "ยังไม่เริ่ม" (surface-2) · PLAYING "กำลังดู" (info-bg navy) · PAUSED "หยุดไว้" (surface-2) ·
  QUIZ_PENDING "รอตอบคำถาม" (warning) · ENDED "ดูจบ" (success); `pointsAwarded > 0` adds "รับแต้มแล้ว" success tag.
- ≤ 600: card per session: top line badge + 🚩; video title; meta line user · start time; progress mini bar.
- States: loading · empty "ยังไม่มีเซสชันค่ะ" · empty with filter "ไม่พบเซสชันตามตัวกรองนี้ค่ะ" + "ล้างตัวกรอง" · error + retry.

### 5.7 `/admin/sessions/[id]` — detail + timeline (`AdminSessionDetailPage`)
#### Summary (top)
Header: "เซสชัน {short id}" + SessionStateBadge + 🚩 "ถูกแจ้งเตือน" (warning pill) when flagged + `ดูทบทวน` tag if replay.
**SessionFacts** grid (4 cols ≥ 1025, 2 cols ≤ 600) from `GET /api/admin/sessions/:id` → `session` = SessionRow +
`{ positionSec, bankSec, softRejectCount, passedQuestionIds, currentQuestionId, questionCount, lastSeq, version, eventCount }` (plan §4.5):
| Label | Value | Emphasis |
|---|---|---|
| ผู้ใช้ | `userId` short id → `/admin/users/{userId}` | |
| วิดีโอ | `videoTitle` → `/admin/videos/{videoId}` | |
| เริ่ม / จบ | `startedAt` / `endedAt` (or "–") | |
| ตำแหน่งล่าสุด / ไกลสุด | `positionSec` / `furthestSec` of `durationSec` | |
| เวลาเล่นจริง | `playedWallSec` vs required `0.9 × durationSec` + mini bar | success when ≥ required |
| คำถามที่ผ่าน | "ผ่าน {passedQuestionIds.length}/{questionCount}" (+ "กำลังรอตอบ" when `currentQuestionId`); `questionCount` = 0 → "ไม่มีคำถาม" | success when all passed |
| เครดิตข้ามคงเหลือ | `bankSec` s of 6 | |
| การปฏิเสธแบบนับสะสม | `softRejectCount` / 3 | warning when ≥ 1, danger when ≥ 3 |
| จำนวนเหตุการณ์ | `eventCount` (last seq `lastSeq`, version `version` — small 13px muted line for debugging) | |
| แต้ม | `pointsAwarded` > 0 → `+{pointsAwarded}` + time of the CLAIM event (`serverAt`) · `isReplay` → "ดูทบทวน (ไม่ได้แต้ม)" · else "ยังไม่ได้รับ" | |
If flagged: **FlagReasonNotice** (warning) summarising why: "ถูกแจ้งเตือนเพราะ: ข้ามไปข้างหน้า (SEEK_FORWARD) 1 ครั้ง" or
"ถูกปฏิเสธสะสม 3 ครั้ง (เร็วผิดปกติ 2 · ดูไม่ครบ 1)" — computed client-side from the timeline events.

#### SessionTimeline (`admin/components/SessionTimeline`)
Source: `events[]` `{ id, seq, type, positionSec, clientAt, serverAt, accepted, rejectReason, fromState, toState, payload }`,
ordered by `serverAt, id`, ≤ 2000, not paged (plan §4.5) — hence TICK collapsing below. Desktop = table; ≤ 600 = vertical
list with a left rail. `clientAt` shown only in the row's expanded detail (display only).

Columns (≥ 601): เวลา (serverAt as `+m:ss` since `startedAt`, full timestamp in `title`) · seq (`#12`, or chip "ระบบ" when
null: RESUME / ANSWER / CLAIM) · เหตุการณ์ (EventTypeChip) · ตำแหน่ง `m:ss.s` · สถานะ (`from → to`, only when changed)
· ผล (accepted ✓ / RejectChip) · รายละเอียด (payload summary: ANSWER "ตอบ B · ถูก/ผิด", CLAIM "+50" / "0").

**Row highlighting (the key requirement):**
| Class | Condition | Visual |
|---|---|---|
| accepted | `accepted = true` | plain row |
| **rejected – flag-worthy** | `rejectReason ∈ {SEEK_FORWARD, SPEED_EXCEEDED, NOT_WATCHED}` | `--danger-bg` row, 4px `--danger` left border, ✕ + RejectChip (danger); the event that set `flagged` (first SEEK_FORWARD, or the 3rd soft reject) gets an extra 🚩 "ทำให้ถูกแจ้งเตือน" chip |
| rejected – benign | `rejectReason ∈ {QUIZ_REQUIRED, BATCH_ABORTED, INVALID_TRANSITION}` | `--surface-2` row, `--text-2`, RejectChip neutral + "(ปกติ ไม่นับ)" |
| state change | `fromState ≠ toState` | `from → to` shown bold; QUIZ_PENDING and ENDED rows get a 2px navy left rule |
| server row | `seq = null` | seq cell chip "ระบบ" |

RejectChip Thai labels (code shown in monospace after the label for admins):
SEEK_FORWARD "ข้ามไปข้างหน้า" · SPEED_EXCEEDED "เร็วผิดปกติ" · NOT_WATCHED "ดูไม่ครบ" · QUIZ_REQUIRED "ต้องตอบคำถามก่อน" ·
BATCH_ABORTED "ยกเลิกทั้งชุด" · INVALID_TRANSITION "ลำดับไม่ถูกต้อง".
EventTypeChip: PLAY เล่น · PAUSE หยุด · TICK ความคืบหน้า · SEEK ย้อน/ข้าม · TAB_HIDDEN ออกจากแท็บ · ENDED จบคลิป ·
ANSWER ตอบคำถาม · CLAIM รับแต้ม · RESUME กลับมาดูต่อ.

Controls above the timeline (44px): toggle "แสดงเฉพาะที่ถูกปฏิเสธ" · toggle "รวม TICK ที่ต่อเนื่อง" (**on by default**:
consecutive accepted TICKs collapse to one row "ความคืบหน้า ×12 · 0:01 → 0:12", expandable; rejected TICKs are never
collapsed) · "ไปยังรายการที่ถูกปฏิเสธถัดไป" (jumps focus to the next highlighted row).
Optional (P5 may cut): **PositionStrip** — 64px-tall SVG above the table, x = time since start, y = position, accepted
points navy, rejected points ✕ danger, quiz triggers as dashed lines; `role="img"` + `aria-label` summary; the table
remains the accessible source.
States: loading (skeleton rows) · empty "ยังไม่มีเหตุการณ์ในเซสชันนี้ค่ะ" · 404 "ไม่พบเซสชันนี้ค่ะ" · error + retry.

### 5.8 Pagination (all paged admin lists)
`{ items, page, pageSize, total }`, pageSize 20 (max 100). Bar under the table: "แสดง {from}–{to} จาก {total}" (14px
`--text-2`) + IconButtons "หน้าก่อนหน้า" / "หน้าถัดไป" (44×44, `aria-disabled` at the ends) + "หน้า {page} / {pages}".
`page` is kept in the URL (`?page=`); changing a filter resets to page 1. ≤ 600: the same bar, full width, buttons at
the edges. Hidden when `total ≤ pageSize`.

---

## 6. Component inventory → folders (plan §2)

### `src/frontend/shared/ui/` (tokens-only, no domain knowledge)
| Component | Variants / props | Used by |
|---|---|---|
| `Button` | `variant: primary-red \| primary-navy \| outline \| outline-white \| white \| ghost \| danger-text`, `size: md(48) \| sm(44)`, `loading`, `aria-disabled`, icon slots | all |
| `IconButton` | 44×44 min, required `aria-label` | back, kebab, copy, show-password, hamburger |
| `Badge` / `Tag` | `tone: navy \| success \| warning \| danger \| info \| neutral`, icon | tags, StatusBadge, SessionStateBadge, RejectChip, EventTypeChip |
| `Card` | `padding`, `interactive` (hover lift + focus ring) | all cards |
| `Modal` | `mode: dialog \| sheet(≤600)`, `dismissible` (false for quiz), focus trap, `inert` background, return focus | QuizModal, confirms |
| `ConfirmDialog` | title, body, confirm tone | archive, delete, unsaved changes |
| `Toast` / `useToast` | tone, duration, rate-limit key | watch resync, admin saves |
| `InlineNotice` | tone, icon, action | notices, LockNotice base |
| `ErrorState` / `EmptyState` | icon, title, body, action | all pages |
| `Skeleton` | `rect \| text \| circle`, reduced-motion aware | loading states |
| `Table` | columns, `aria-sort`, stacked-cards mode ≤ 600, row link, row tone (`warning \| danger \| muted`) | admin tables, timeline |
| `Tabs` / `SegmentedControl` | 44px segments, `aria-selected` | video filters |
| `Switch` | 44px hit area, `role="switch"` | session/timeline filters |
| Form fields: `TextField`, `TextArea` (counter), `NumberField`, `Select`, `RadioGroup`, `PasswordField` (toggle), `TimeField` (`m:ss.s` parse/format) | label, helper, error, `locked` state (readonly + 🔒 + describedby) | admin forms, login |
| `ProgressBar` | read-only, `valueText` | WatchProgress base, admin mini bars |
| `Drawer` | focus trap, Esc | admin mobile nav |

### `src/frontend/public/components/`
`PublicHeader` · `PointsBadge` · `PointsSummary` · `FeaturedVideoCard` · `VideoCard` · `VideoGrid` · `VideoPlayer`
(iframe + click shield + centre play) · `ControlBar` (wrapped by `LiveControlBar` + `usePlayerProgress` for ~10 Hz player-time display) · `WatchProgress` (+ quiz markers) · `StatusLine` ·
`QuizProgress` · `QuizModal` · `ChoiceButton` · `ContextBanner` · `RewardCard` · `HowItWorks`.
Pages: `VideoListPage` (§3), `WatchPage` (§4, the only reducer owner). Copy strings: `public/constants/copy.th.ts`.

### `src/frontend/admin/components/`
`AdminShell` (sidebar/topbar/drawer) · `StatTiles` · `VideoTable` · `StatusBadge` · `VideoDetailsForm` ·
`YouTubePreview` · `LockNotice` · `QuizEditor` · `QuestionCard` · `ChoiceRow` · `UserTable` · `SessionTable` ·
`SessionStateBadge` · `SessionFacts` · `FlagReasonNotice` · `SessionTimeline` · `EventTypeChip` · `RejectChip` ·
`PositionStrip` (optional). Pages: `AdminLoginPage`, `AdminDashboardPage`, `AdminVideoListPage`, `AdminVideoEditPage`
(new + edit), `AdminUserListPage`, `AdminUserDetailPage`, `AdminSessionListPage`, `AdminSessionDetailPage`.
Copy strings: `admin/constants/copy.th.ts`.
Import rule respected: `public` and `admin` import `shared/ui` only; never each other.

---

## 7. Accessibility checklist (WCAG 2.2 AA)
- **Targets ≥ 44×44**: Play 48, CTA 48–52, choices ≥ 56 tall, IconButtons 44, admin inputs 48, radios/switches 44 hit
  area, tabs 44, collapsed question rows 48, card links whole-card. Non-interactive: badges, progress bars.
- **Contrast**: all text pairs in §1.1 ≥ 4.5:1 (large text on the reward card ≥ 3:1 not relied on — body text there is
  ≥ 7.56). UI boundaries (inputs, choice borders, progress fill, quiz markers) ≥ 3:1. Locked fields keep 6.9:1 text.
- **Never colour alone**: ✓/✕/🔒/🚩 icons + text for correct/wrong/locked/flagged/rejected/status.
- **Keyboard**: logical tab order; visible `:focus-visible` ring everywhere; modals/drawers trap focus and restore it;
  quiz modal cannot be dismissed but explains why; no keyboard seek on the public player; timeline "jump to next rejected".
- **Screen reader**: `<html lang="th">`; progressbar `aria-valuetext` in Thai; StatusLine polite, quiz feedback assertive,
  reward/badge status, errors alert; icon-only buttons have Thai `aria-label`; tables use `<th scope>` and `aria-sort`.
- **Motion**: `prefers-reduced-motion` removes lift, shake, confetti, count-up, shimmer, slide (fade ≤ 150ms kept).
- **Zoom/reflow**: 200% zoom and 320 CSS px width reflow without horizontal scroll (except inside wide admin tables,
  which switch to cards ≤ 600 instead of scrolling).
- **Forms**: visible labels, `autocomplete`, errors linked with `aria-describedby`, first invalid field focused.
- **Media**: the YouTube iframe has a Thai `title`; captions remain YouTube's (not controllable with `controls:0` —
  accepted limitation, noted for the human).

## 8. Responsive / test checklist (for P4 manual + P6 tester)
- Public: 360×640, 390×844, 430×932, 768×1024, 1280×800 — no horizontal scroll; at 360×640 the player + ControlBar are
  above the fold; quiz sheet shows prompt + 4 choices (≤ 2 lines each) without scrolling; RewardCard fits in 360 width.
- iOS Safari: `playsinline` keeps the video inline; inputs are 16px (no zoom); bottom sheet respects safe-area inset.
- Landscape phone 640×360: sheet max-height 85vh with internal scroll.
- `/` states: 0, 1, n videos; featured null; all rewarded; errors.
- Watch: every row 1–23 in §4.4 and every row in §4.5.
- Admin at 1280 and 390: login states, dashboard, list ↔ card switch, form with preview + sticky time bar, locked
  video, quiz editor add/edit/delete/validation, user list/detail, session list with filters, timeline highlight classes.

## 9. Contract items — closed (plan §4.5, 2026-09-24)
| # | Item | Resolution (exact keys) | Spec section |
|---|---|---|---|
| 1 | question count on `/` | `questionCount` on `GET /api/videos` items | §3.1, §3.2 |
| 2 | dashboard stats | `GET /api/admin/stats?videoId` → `{ views, completions, pointsAwarded, flaggedSessions }` | §5.2 |
| 3 | lock indicator | admin video `{ …, questionCount, sessionCount, locked }` (`locked = sessionCount > 0`) | §5.3, §5.4 |
| 4 | `rewardPoints` bound | integer 1–1000 | §5.4 |
| 5 | choice add/remove when locked | locked | §5.4 |
| 6 | duplicate `triggerSec` | 409 `DUPLICATE_TRIGGER` | §5.4 QuizEditor |
| 7 | publish with 0 questions | allowed, UI warning | §5.4 |
| 8 | users list/detail | items `{ id, createdAt, totalPoints, sessionCount, lastActiveAt }`; detail `{ user, ledger[{ sessionId, videoId, videoTitle, points, createdAt }], sessions[SessionRow] }` | §5.5 |
| 9 | sessions list | SessionRow `{ id, userId, videoId, videoTitle, state, flagged, isReplay, furthestSec, durationSec, playedWallSec, pointsAwarded, startedAt, endedAt }` | §5.6 |
| 10 | session detail | `{ session: SessionRow + { positionSec, bankSec, softRejectCount, passedQuestionIds, currentQuestionId, questionCount, lastSeq, version, eventCount }, events[] }` | §5.7 |
| – | paging | `?page&pageSize` (20, max 100) → `{ items, page, pageSize, total }` | §5.8 |

`APP_NAME` = "ดูคลิป รับแต้ม" — **final**, confirmed by the human 2026-09-24. No open items remain.
