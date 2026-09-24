# Reference — EngOnAir (https://www.engonair.com/)

Status: v1 (designer, 2026-09-24) · purpose: visual target chosen by the human.
**Source of every value below:** the site's production CSS (`/_next/static/chunks/*.css`, 3 files, fetched
2026-09-24) plus headless screenshots at 390×844 and 1280×800. Nothing is guessed from memory. Contrast
ratios were computed with the WCAG formula (script), not estimated.

---

## 1. Brand at a glance
- **Two-colour brand:** deep royal blue (`#1D3793`) for structure (header, footer, badges, dark sections) and
  red (`#D81E1D`) for **every call to action**. The logo wordmark follows the same split ("Eng**On**Air" with
  "On" in red).
- Warm off-white page (`#F0EEE9`) with white cards. Faint grid/skyline illustration behind the hero.
- Big, heavy headings (800–900 weight) in dark navy `#1A2A5E`; body text in near-black.
- Rounded, friendly shapes: **pill buttons (50px radius)** with a soft red glow, cards with 16–20px radius.
- Tone: warm, encouraging, teacher-to-student. ครูหวาน (Kru Whan) speaks in the first person and ends
  sentences with **"นะคะ"**. Mixes Thai with English course names/terms (TOEIC, CEFR, "Ready to Speak").

## 2. Design tokens (as found → how we use them)

### Colour
| Our token | EngOnAir value | Where they use it | Contrast (verified) |
|---|---|---|---|
| `--brand-primary` | `#1D3793` | header, footer, level badge, dark sections | white on it **10.4:1** |
| `--brand-primary-dark` | `#1A2A5E` | headings, card titles | on `#F0EEE9` **11.79:1** |
| `--brand-accent` (CTA) | `#D81E1D` | all CTA buttons, price, hover title | white on it **5.09:1** ✓ AA |
| `--brand-accent-hover` | `#B91C1C` (also `#B51716`) | CTA hover | white on it 6.47:1 |
| `--brand-tertiary` | `#6B7FD7` | (declared, rarely used) | 3.72:1 on white → **decorative only, never text** |
| `--bg` | `#F0EEE9` | page background | |
| `--surface` | `#FFFFFF` | cards | |
| `--text` | `#111827` | body text | on bg 15.3:1 |
| `--text-body-2` | `#475569` | excerpts | on bg 6.54:1 |
| `--text-muted` | `#64748B` | meta line, strikethrough price | on white 4.76:1 ✓ · **on bg `#F0EEE9` only 4.1:1 ✗** → use `#475569` on bg |
| `--border` | `#E2E8F0` / `#CBD5E1` | card and outline-button borders | |
| `--gold` | `#FCD34D` | star icon / badge on the blue score card | on `#1D3793` **7.21:1** |
| score gradient | `#1E3A8A → #3B82F6` 135° | placement-test result card | white on `#3B82F6` end only 3.68:1 → ok for ≥24px bold, not body |

### Typography
- Font: **LINE Seed Sans TH** (Regular + Bold, self-hosted woff2), fallback `sans-serif`.
  → We use `"LINE Seed Sans TH", "Noto Sans Thai", sans-serif`. **Do not hotlink their woff2.** LINE Seed
  is distributed by LINE under the SIL OFL; the coder must download it from LINE's official source and
  self-host it. **✅ Decided (human, 2026-09-24): approved** — SIL Open Font License 1.1, verified on
  seed.line.me. Self-host the woff2 in the app; keep Noto Sans Thai only as the fallback in the stack.
  **Rule (human):** if the LINE Seed licence ever stops allowing our use, switch **entirely** to Noto Sans Thai
  (not a mix). Today it is OFL 1.1 → LINE Seed primary, Noto fallback.
- Scale they use (mobile → desktop):

| Role | Mobile | Desktop | Weight | Colour |
|---|---|---|---|---|
| Hero / section title | 28.8–36px (1.8–2.25rem) | 40–48px | 800–900, `letter-spacing:-.5px` | `#1A2A5E` |
| Card title | 17.6–19px (1.1–1.2rem), 2-line clamp | 21.6px | 800 | `#1A2A5E` |
| Body | 16–17px, line-height 1.6 | same | 400 | `#222`/`#111827` |
| Meta | 11–12px | same | 500 | `#64748B` |
| Button | 16–17.6px | same | 700 | white |
| Big number (score) | 72px | 96px | 900 | white |

  Note: their meta text at 11px (.7rem) is too small for our a11y bar → we keep a **13px minimum**.

### Shape, spacing, elevation
| Token | Value |
|---|---|
| `--radius-pill` | `50px` (all buttons) |
| `--radius-card` | `20px` (course card) / `16px` (post card, mobile) |
| `--radius-media` | `14px` (16:9 thumbnail inside card) |
| `--radius-tag` | `6px` (level badge) |
| `--shadow-card` | `0 12px 35px #0000000D` (mobile: `0 5px 5px #0000000D`) |
| `--shadow-card-hover` | `0 20px 45px #1A2A5E1A` + `translateY(-8px)` |
| `--shadow-cta` | `0 4px 15px #D81E1D33` → hover `0 8px 25px #D81E1D4D` + `translateY(-2px)` |
| Page gutter | 16px mobile (≤600px) · 24–32px tablet · 32px desktop · content max-width 1600px |
| Card padding | 16px mobile · 20px desktop |
| Grid gap | 12px mobile · 24–32px desktop |
| Motion | 200–300ms, `cubic-bezier(.25,.8,.25,1)`; result card `slideUp` 0.5s |

### Breakpoints (theirs; we align to them)
`≤600px` phone · `601–1024px` tablet (hamburger still) · `1025–1179px` small desktop · `≥1180px` desktop.
Card grid: 3 cols ≥1200 · 2 cols 1025–1199 · **≤1024 horizontal scroll-snap carousel** (card 42% / 85% on phone).

## 3. Components to borrow

| # | Component | EngOnAir spec | Use in our app |
|---|---|---|---|
| C1 | **Header** | sticky, `#1D3793`, 1px bottom border white 10%, padding 16px, logo left, nav right; ≤1024 → hamburger (3 bars, white) opening a full-screen blue drawer (60vw on tablet) | Header of `/` and `/watch/*`. Our header only needs logo/title + **PointsBadge** on the right, so **no hamburger** on the viewer pages (nothing to put in it). |
| C2 | **CTA pill button** | red `#D81E1D`, white 700 text, radius 50px, padding 16px 40px (full width in cards), red glow shadow, hover darker + lift 2px | Play button in large form, "เริ่มดูคลิป", "ลองบันทึกอีกครั้ง", "ลองใหม่". Height ≥48px. |
| C3 | **Outline pill button** (`retakeButton`) | white bg, `#1E3A8A` text, 1px `#CBD5E1` border, radius 32px, 600 weight | Secondary actions: "ดูอีกครั้ง", admin "ยกเลิก". |
| C4 | **Course card** | white, radius 20px, 1px navy-5% border, soft shadow; 16:9 thumbnail radius 14px; level badge (navy tag); 2-line title; meta row with icons; 3-line excerpt; full-width red CTA at the bottom | **Video card** on `/` (thumbnail + title + duration + "+50 แต้ม" tag + CTA "ดูคลิป"). The "already rewarded" state swaps the CTA to an outline "ดูอีกครั้ง" + ✓ tag. |
| C5 | **Level badge tag** | navy `#1D3793` bg, white 600 text, 11.5px, radius 6px | Tags on the video card: duration, "+50 แต้ม", "ได้แต้มแล้ว ✓". Bump the size to ≥12px. |
| C6 | **Score / result card** | 135° blue gradient, white text, radius 24px, star icon `#FCD34D`, huge 900-weight number, `slideUp` entrance, translucent pill for the level | **Reward banner "ยินดีด้วย +50 Points"**: gold star, big "+50", label "Points". Strongest match to the brief. |
| C7 | **Glass message box** | `#FFFFFF1A` bg, 1px `#FFFFFF33` border, radius 16px, italic | Secondary line inside the reward card ("แต้มสะสมทั้งหมด …"). Drop the italic for Thai (italic Thai reads poorly). |
| C8 | **Horizontal card carousel (mobile)** | `scroll-snap-type:x mandatory`, hidden scrollbar, card 85% wide so the next one peeks **Not used** (planner, 2026-09-24). `/` = a featured card for the brief's video at the top, then a vertical list; on desktop the list becomes a 2–3 column grid. States: 0 published videos (empty), 1 video (featured card only). |
| C9 | **Loading text** | centred `#64748B`, 20px, min-height 50vh | Replace with skeletons (spec.md), but keep the colour. |
| C10 | **Footer** | `#1D3793`, white 90% text, 4-column grid → 1 column ≤767 | Optional, minimal: one line of copy + a link to the EngOnAir site. |

**Do not borrow:** the hero photo, skyline illustration, or partner logos (content, not system). The logo
itself is owned by EngOnAir → **✅ Decided (human, 2026-09-24): no EngOnAir logo and no "Eng**On**Air"
wordmark styling.** Use a neutral text wordmark (our own app name, `--brand-primary-dark` 800 weight). EngOnAir
/ the YouTube channel is named only as the **video source** (e.g. a small "วิดีโอจาก YouTube: {channel}"
line under the player/card), not as our brand. `{channel}` = API field `channelName` (plan v4: filled by the
server from oEmbed `author_name`; returned per video in `GET /api/videos` and as `video.channelName` in
`POST /api/sessions`). Never hard-code it. If it is empty, hide the line.

## 4. Conflicts with our design and how to resolve them
1. **Red means "act" on EngOnAir, but red also means "wrong answer" in the quiz.** If both are red, a
   wrong choice looks like a button. Resolution: CTAs stay brand red (filled pill); a wrong choice uses the
   *light* `#FEF2F2` bg + `#B91C1C` 1.5px border + ✕ icon + text "ยังไม่ถูก…" (no fill, no glow), so it
   reads as feedback, not an action. The correct choice uses green `#047857` (not a brand colour, but
   needed for right/wrong semantics; 5.48:1 on white).
2. **Red on blue** (`#D81E1D` on `#1D3793`) = **2.04:1**. Never put a red button directly on the blue header
   or on the blue reward card; put red CTAs on white/off-white only.
3. **Muted grey on the off-white bg fails AA** (4.1:1) → on `--bg` use `#475569`.
4. **Hover-lift animations** (`translateY(-8px)`) are desktop-only and disabled under
   `prefers-reduced-motion`; on touch they do nothing.
5. Their 11px meta and 11.5px tags → we use ≥12–13px.

## 5. Copy tone guide (Thai)
- Friendly teacher voice, polite female ending **"ค่ะ / นะคะ"** in encouraging lines, e.g.
  "ดูให้จบแล้วมาตอบคำถามกันนะคะ", "ถูกต้องค่ะ! ดูต่อได้เลย", "ยังไม่ถูกนะคะ ลองอีกข้อดูค่ะ".
  **✅ Decided (human, 2026-09-24): ครูหวาน voice**, friendly teacher, "ค่ะ/นะคะ" on encouraging and
  instructional lines. Error copy stays short and clear (a polite "ค่ะ" is ok, no jokes) and
  short in both cases ("โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่").
- Short action verbs on buttons: "ดูรายละเอียด…", "…ทั้งหมด" → ours: "ดูคลิป", "ดูอีกครั้ง", "ลองใหม่".
- English terms are left in English (Points, TOEIC); the banner "ยินดีด้วย +50 Points" fits this style.

## 6. Ready-to-paste token block (for spec v2, not applied yet — spec.md is on HOLD)
```css
:root {
  --brand-primary: #1D3793;  --brand-primary-dark: #1A2A5E;
  --brand-accent:  #D81E1D;  --brand-accent-hover: #B91C1C;
  --bg: #F0EEE9; --surface: #FFFFFF; --text: #111827;
  --text-2: #475569; --text-muted: #64748B; /* muted: on white only */
  --border: #E2E8F0; --border-strong: #CBD5E1;
  --gold: #FCD34D;
  --success: #047857; --success-bg: #ECFDF5;
  --danger: #B91C1C;  --danger-bg: #FEF2F2;
  --radius-pill: 50px; --radius-card: 20px; --radius-media: 14px; --radius-tag: 6px;
  --shadow-card: 0 12px 35px #0000000D; --shadow-cta: 0 4px 15px #D81E1D33;
  --font: "LINE Seed Sans TH", "Noto Sans Thai", sans-serif;
}
```

## 7. Open questions
1. ~~[human] Font licence~~ ✅ approved: LINE Seed Sans TH, OFL 1.1, self-hosted.
2. ~~[human] EngOnAir logo~~ ✅ no: neutral wordmark; the channel is named only as the video source.
3. ~~[human] Copy voice~~ ✅ ครูหวาน style "ค่ะ/นะคะ", friendly teacher.
4. ~~[planner] How many videos on `/`?~~ Answered: the count varies (admins add videos) → featured card + vertical list/grid, no carousel.
