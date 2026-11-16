# Design

## Visual theme

A bank-grade lottery app. White working surfaces on a faintly violet canvas. A deep royal violet carries actions and the one committed brand surface, the wallet card. Gold appears only for wins. The single brand motif is **guilloche**: the fine looping security lines printed on Thai banknotes and government lottery tickets, rendered as thin SVG strokes at low opacity on violet surfaces. The second motif is the **ticket**: bills and results use a perforated divider with half-circle notches, because a bill is a ticket.

Scene: a player on a bright BTS platform at 08:45 racing the Nikkei cutoff with one thumb. That forces a light theme, large tabular digits, and high contrast.

Color strategy: **Restrained** for product surfaces. **Committed** (violet carries the surface) only on the wallet card, the auth side panel, and the landing hero.

## Color tokens (OKLCH only)

| Token | Value | Use |
|---|---|---|
| `--canvas` | `oklch(0.975 0.004 285)` | page background |
| `--surface` | `oklch(1 0 0)` | cards, sheets, inputs |
| `--panel` | `oklch(0.955 0.008 285)` | second neutral: sidebars, table headers, keypad |
| `--line` | `oklch(0.915 0.01 285)` | hairline borders |
| `--line-strong` | `oklch(0.84 0.014 285)` | input borders, dividers that must be seen |
| `--ink` | `oklch(0.22 0.03 285)` | body text (17.4:1 on white) |
| `--ink-2` | `oklch(0.44 0.025 285)` | secondary text (7.8:1) |
| `--ink-3` | `oklch(0.53 0.02 285)` | tertiary text, placeholders (5.3:1, 4.65:1 on panel) |
| `--brand` | `oklch(0.46 0.19 282)` | primary actions, selection, links (white text 7.7:1) |
| `--brand-hover` | `oklch(0.41 0.18 282)` | hover |
| `--brand-press` | `oklch(0.37 0.16 282)` | active |
| `--brand-soft` | `oklch(0.955 0.022 285)` | selected rows/chips background |
| `--brand-soft-ink` | `oklch(0.42 0.17 282)` | text on brand-soft (7.9:1) |
| `--brand-deep` | `oklch(0.30 0.12 284)` | committed surfaces (wallet card, hero) |
| `--on-deep-2` | `oklch(0.82 0.05 285)` | secondary text on brand-deep (8:1) |
| `--gold` | `oklch(0.84 0.13 84)` | win fills, win badge; ink text on it (10.6:1) |
| `--gold-ink` | `oklch(0.38 0.08 70)` | text on pale gold surfaces |
| `--gold-text` | `oklch(0.50 0.10 72)` | win amounts as text on white (6.1:1) |
| `--success` / `--success-soft` | `oklch(0.50 0.12 155)` / `oklch(0.96 0.03 155)` | approved, credited |
| `--warning` / `--warning-soft` | `oklch(0.52 0.12 62)` / `oklch(0.965 0.03 80)` | closing soon (<15 min), cut rate |
| `--danger` / `--danger-soft` | `oklch(0.52 0.19 27)` / `oklch(0.965 0.018 25)` | closing now (<5 min), errors, closed number |

Text on any saturated fill is white. Gold fill takes ink text.

### Colour themes

The table above is **ม่วงราชา (royal)**, the default. Four more themes swap only the neutral tint and the brand family; gold and the status colours never change. Each is applied as `<html data-theme>` from the `theme` setting (cached, tag `theme`) and defined in `globals.css` under `:root[data-theme="..."]`. Decorative art and slides follow `--art-h`, the theme's hue.

| Theme | Brand | Brand deep | Hue | White on brand | Brand on canvas |
|---|---|---|---|---|---|
| ม่วงราชา `royal` | `oklch(0.46 0.19 282)` | `oklch(0.30 0.12 284)` | 282 | 7.7:1 | 7.2:1 |
| มรกต `emerald` | `oklch(0.47 0.105 162)` | `oklch(0.30 0.062 165)` | 162 | 6.4:1 | 6.0:1 |
| ไพลิน `sapphire` | `oklch(0.48 0.16 257)` | `oklch(0.30 0.11 258)` | 257 | 6.7:1 | 6.2:1 |
| ทับทิม `ruby` | `oklch(0.49 0.18 18)` | `oklch(0.30 0.11 16)` | 18 | 6.9:1 | 6.4:1 |
| อัสดง `sunset` | `oklch(0.50 0.155 38)` | `oklch(0.31 0.09 36)` | 38 | 6.5:1 | 6.0:1 |

Every theme also keeps ink 16:1, ink-2 7.1:1, ink-3 4.6:1 on panel, and on-deep-2 7.6:1 on brand-deep (OKLCH converted to sRGB and checked with the WCAG 2 formula).

### Chart palette

Charts use the validated dataviz reference slots, not the theme: `--color-viz-1` `#2a78d6`, `--color-viz-2` `#eb6834`, `--color-viz-3` `#1baf7a`, `--color-viz-4` `#eda100` (adjacent CVD ΔE ≥ 9.1 on white; 3 and 4 sit under 3:1 so they always come with labels). Polarity (profit/loss) uses `--color-viz-pos` blue and `--color-viz-neg` `#e34948`. Gridlines `#e1e0d9`, baseline `#c3c2b7`, sparkline `#b8b6ae`. Marks are ≤ 24px with a 4px rounded data end, one axis, a legend for 2+ series, a hover/keyboard tooltip, and a table view on every chart.

## Typography

One family: **IBM Plex Sans Thai** (400, 500, 600, 700) through `next/font/google`, Thai and Latin subsets. Money, countdowns, numbers, and results always use `font-variant-numeric: tabular-nums`.

Fixed rem scale, ratio ≈ 1.2: `12 / 14 / 16 / 19 / 23 / 28 / 34` px. Body is 16/1.65, labels 14/1.5, headings 1.3 line-height with `text-wrap: balance`. Large figures (balance, the result's first prize) are 34px/600 with tabular digits.

## Space, shape, depth

- Spacing: a 4px base, using `4 8 12 16 20 24 32 40 48 64`.
- Radius: 10px for controls, 14px for cards and sheets, 999px for pills and chips.
- Depth: cards use `0 1px 2px oklch(0.22 0.03 285 / 0.06)` plus a hairline border. Floating layers (sheets, popovers, toasts) use `0 12px 32px oklch(0.22 0.03 285 / 0.16)`.
- z-index scale: `sticky 20 · header 30 · nav 30 · overlay 40 · sheet 50 · toast 60 · tooltip 70`.

## Layout

- **Mobile (<768px):** top bar (logo, balance pill), content, and a bottom tab bar with 5 tabs: หน้าแรก, แทงหวย, โพย, ผลรางวัล, บัญชี. The bet slip is a bottom sheet.
- **Tablet and desktop (≥1024px):** a 248px left sidebar with labelled nav, a top bar with the balance, ฝาก, and ถอน, and content up to 1200px wide. The bet page becomes two columns, with the composer on the left and a sticky slip on the right (360px).
- **Admin:** its own shell. Dense tables, a sticky header, and filters in a toolbar. The sidebar groups the menu (ภาพรวม, หวย, สมาชิกและการเงิน, การตลาด, ระบบ) and shows only what the staff member's role allows. Dashboards and reports put one period filter row (presets first, then a custom range) above everything it scopes; the dashboard leads with one hero figure (กำไรจากการแทง) and a row of stat tiles.

## Components

Every interactive component has default, hover, focus-visible (2px brand ring offset 2px), active, disabled, loading, and error states.

- **Buttons:** primary (brand fill), secondary (surface with line-strong border), ghost, and danger. Heights are 44 (default) and 36 (compact, admin). Labels use verb + object.
- **Countdown:** a tabular `HH:MM:SS` with a state badge. `calm` uses ink. `soon` (<15m) uses warning text plus a "ใกล้ปิด" label. `urgent` (<5m) uses danger text plus "ปิดใน X นาที". `closed` uses ink-3 plus "ปิดรับแล้ว".
- **Rate chip:** `3 ตัวบน ×900`. A cut rate shows the old rate struck through, the new rate in warning, and a "อั้น" label. A closed number shows a danger "ปิดรับ".
- **Ticket divider:** a dashed line with 8px half-circle notches at both edges, used in bills and result cards.
- **Skeletons** for loading (never centered spinners in content), and empty states that teach the next action.

## Motion

Durations of 160–220ms, `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart). Motion only conveys state: a number added to the slip, the sheet opening, a countdown flipping to urgent, the balance changing. The win reveal is the one celebratory moment, a gold sweep across the bill. Under `prefers-reduced-motion`, everything becomes an instant swap or a crossfade.

## Imagery and slider

- **Illustration style:** original vector art (`src/components/art`), using shared gradients defined once in `ArtDefs` (gold, violet, red, ink, and glossy balls) with soft drop shadows and specular highlights. Pieces include coin, tilted coin, coin stack, lottery ball, ticket, gift box, red envelope, trophy, phone, friends, coupon, chat bubble, stock chart, light rays, and glints.
- **Banner scenes** (`BannerArt`): gift, ticket, envelope, balls, phone-check, phone-share, trophy, coins. Each sits on a deep-violet slide with a tone glow (violet, gold, red, or night), plus light rays and a faint guilloche.
- **Home slider:** 216px on mobile, 260px from sm, 300px from lg. Native scroll-snap swipe. Autoplays every 5.5s, pausing on hover, on focus, and when the tab is hidden. There is a visible pause button, and no autoplay under reduced motion. Slide text is HTML: a tag chip, a title with `[highlight]` in gold, a subtitle or live countdown, and a gold call-to-action button. One live slide for the next Thai government draw is inserted second. Admins edit banners at `/admin/banners`; an uploaded image covers the slide, and its text can be hidden.
- **Small art:** the quick-menu tiles (56–64px), lottery category headers in the lobby (44px), promotion cards, the sign-in side panel, the empty bills state, and the winning-bill banner.
- **Motion:** coins and balls float gently (4.8s, ±6%). It is disabled under `prefers-reduced-motion`.

## Iconography

`lucide-react` only, 1.75px stroke, 20px in UI and 18px in dense admin tables.
