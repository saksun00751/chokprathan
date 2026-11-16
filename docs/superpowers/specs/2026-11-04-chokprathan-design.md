# โชคประทาน: online lottery platform (design spec)

Date: 2026-11-04. Status: decided with the user via chat. The user asked for a complete site that is better than the reference ดั่งหวังง.com (a site they do not own). We study its features but do not reuse its branding, assets, or copy. See PRODUCT.md (strategy) and DESIGN.md (visual system).

## 1. Scope

The user asked for everything in one round:

- **Public:** home (landing for guests, dashboard for members), lotto lobby, results and per-lotto history, pay-rate table, rules, promotions list, contact, login, 3-step register with demo OTP, and forgot password with demo OTP.
- **Member:** bet page (composer plus slip), bills and bill detail (with cancel), wallet (deposit, withdraw, transactions), saved number sets, affiliate (2 tiers), cashback, voucher redeem, account (profile, bank, password), and game lobbies (casino/slot/sport, mock providers).
- **Admin:** dashboard, rounds (list, detail, exposure, result entry, cancel), risk settings (auto rate reduction plus manual อั้น), lotto types (schedule, rates, limits, auto-result), members (search, detail, balance adjust, suspend), finance queues (deposits, withdrawals), promotions, vouchers, news, site settings, and an audit log.
- **Out of scope (simulated):** real payment gateways, real game providers, and SMS. Deposits are approved by an admin, or instantly when the demo setting is on. OTP codes are shown on screen in demo mode.

## 2. Lotto catalog and schedules

Lotto types live in the DB and can be edited in admin. Seeded groups and types (all times are Asia/Bangkok, UTC+7, no DST):

| Group | Types (closes at) | Schedule | Result format | Auto result |
|---|---|---|---|---|
| `thai` หวยไทย | รัฐบาลไทย 15:10 · ออมสิน 10:00 · ธ.ก.ส. 09:00 | days of month 1,16 (ออมสิน, ธ.ก.ส.: 16) | `thai_gov` for รัฐบาล, else `standard` | no (admin enters) |
| `foreign` ต่างประเทศ | ลาวพัฒนา 20:15 (Mon/Wed/Fri) · ลาว VIP 21:05 · ลาวสตาร์ 15:35 · ฮานอยพิเศษ 17:05 · ฮานอยปกติ 18:05 · ฮานอย VIP 19:05 · มาเลย์ 18:20 (Wed/Sat/Sun) | daily unless noted | `laos4` for the Laos types, else `standard` | yes |
| `stock` หวยหุ้น | นิเคอิเช้า 09:25 · จีนเช้า 10:25 · ฮั่งเส็งเช้า 10:50 · ไต้หวัน 12:30 · เกาหลี 12:55 · นิเคอิบ่าย 12:55 · จีนบ่าย 13:55 · ฮั่งเส็งบ่าย 14:55 · สิงคโปร์ 16:00 · หุ้นไทยเย็น 16:00 · อินเดีย 17:00 · อียิปต์ 19:00 · รัสเซีย 22:00 · อังกฤษ 22:30 · เยอรมัน 22:30 · ดาวโจนส์ 00:30 (+1 day) | Mon–Fri | `standard` | yes |
| `yiki` ยี่กี | ยี่กี 88 rounds | every 15 min; round 1 closes 06:00, round n closes 06:00 + 15(n−1) min | `standard` | yes |

- A round opens when the previous round of the same type closes. For day-based types it opens at 00:00 on its draw day. The draw (result time) is `closesAt + resultDelayMin` (default 20, Yiki 2).
- Round status is derived from time and stored fields: `open` (now < closesAt, not cancelled), `closed` (now ≥ closesAt, no result), `resulted`, `cancelled`.

## 3. Bet types, results, matching

Result fields per round: `top3` (3 digits), `bottom2` (2 digits), and optionally `top4`, `front3[2]`, `back3[2]`, `first6`.

- `standard`: admin enters top3 and bottom2.
- `thai_gov`: admin enters first6, front3×2, back3×2, bottom2. Then top3 = last 3 of first6.
- `laos4`: admin enters top4. Then top3 = last 3 of top4, and bottom2 = first 2 of top4.

| Code | Label | Digits | Wins when | Available on | Default rate |
|---|---|---|---|---|---|
| `top4` | 4 ตัวบน | 4 | number = top4 | `laos4` | ×6000 |
| `top3` | 3 ตัวบน | 3 | number = top3 | all | ×950 |
| `tod3` | 3 ตัวโต๊ด | 3 | sorted digits equal sorted top3 | all | ×150 |
| `front3` | 3 ตัวหน้า | 3 | number ∈ front3 | `thai_gov` | ×450 |
| `bottom3` | 3 ตัวล่าง | 3 | number ∈ back3 | `thai_gov` | ×450 |
| `top2` | 2 ตัวบน | 2 | number = last 2 of top3 | all | ×95 |
| `bottom2` | 2 ตัวล่าง | 2 | number = bottom2 | all | ×95 |
| `runTop` | วิ่งบน | 1 | digit appears in top3 | all | ×3.2 |
| `runBottom` | วิ่งล่าง | 1 | digit appears in bottom2 | all | ×4.2 |

Payout = Σ over segments (stake × rate). The stake is not returned on top of that. Each item wins at most once: for `front3`/`bottom3`, the same number drawn twice still pays once.

Default stake limits per bet type: min ฿1, max per number per bill ฿2,000 (`top4` ฿200, `run*` ฿5,000), and max ฿50,000 per bill. Stakes are whole baht.

## 4. Automatic rate reduction (risk engine)

The user's requirement: "ปรับลดอัตราจ่ายเมื่อตัวใดมีการแทงเข้ามาเยอะ และให้ตั้งค่าแก้ไขได้" (cut the payout rate when a number takes a lot of bets, and make it configurable).

- **Exposure key:** (round, betType, number) → total accepted stake from all members (cancelled bills excluded). It's stored in `exposures` and updated in the same transaction as each bill.
- **Risk profile** per bet type: `enabled`, `tiers: [{ threshold, percent }]` (threshold in baht of total stake, percent of the base rate, sorted ascending, percents strictly decreasing, each 1–99), and `cap` (total stake at which the number closes; null = no cap).
  - Defaults:
    - `top3`: `[2000→75, 5000→50]`, cap 10000
    - `tod3`: `[3000→70]`, cap 8000
    - `top2`/`bottom2`: `[5000→75, 15000→50]`, cap 30000
    - `front3`/`bottom3`: `[3000→70]`, cap 8000
    - `run*`: `[20000→80]`, cap 50000
    - `top4`: `[500→70]`, cap 1000
- **Scope:** a global profile per bet type. Each lotto type may override the profile per bet type (null = inherit).
- **Manual อั้น:** per round, the admin lists numbers per bet type with `percent` (fixed reduced rate) or `closed`.
- **Pricing a new stake S** on a key with current total T: split [T, T+S) at the tier thresholds. Each slice gets base × percent of its tier, or 100% below the first threshold. A manual percent caps each slice: rate = min(tier, manual). If T+S > cap, the line is rejected with `remaining = cap − T` (never silently trimmed). A manual `closed`, or T ≥ cap, rejects the line with remaining 0.
- **Segments** are stored on the bill item: `[{ stake, rate100 }]`. The effective rate is shown as a weighted average. For example, top3 base 950 with T=1,800 and S=500 gives 200×950 + 300×712.5.
- **Quote then place:** the slip calls `quoteBill`. Placement re-prices inside a transaction. If any item's payout differs from the confirmed quote, it returns `rate_changed` with the fresh quote, unless the member ticked "ยอมรับอัตราใหม่อัตโนมัติ".
- **Visibility:** the bet page polls `/api/rounds/[id]/limits` every 15s. Numbers with a cut rate or closed are badged in the panel grid and the slip. The admin exposure table shows total stake, potential payout, and current rate per number.

## 5. Money

- All amounts are integer satang. Rates are stored as integer rate×100 (950 → 95000, 3.2 → 320). Payout satang = stake_baht × rate100.
- Wallets per user: `balance`, `cashback_balance`, `affiliate_balance`. Every change writes a `transactions` row: type, signed amount, balance_after, ref, note.
- **Deposit:** pick an amount (min ฿100, max ฿100,000) and an optional promotion. The system shows the receiving bank account from settings and a unique satang tail, e.g. ฿500.37. The member presses "แจ้งโอนแล้ว", which makes the deposit `pending`. The admin approves (credit plus bonus) or rejects it. Demo setting `depositAutoApprove` (default on) approves immediately.
- **Withdraw:** min ฿100, max ฿50,000, max 5 per day, to the bank account on file. Funds are held at request and refunded on reject. It's blocked while turnover is outstanding.
- **Turnover:** a promotion bonus adds a requirement of (deposit + bonus) × multiplier. Settled stakes count down the outstanding amount.
- **Cashback:** when a losing item settles, add stake × `cashbackPercent` (default 5%) to cashback_balance. Claim moves it to balance (min ฿1).
- **Affiliate:** each user has a 6-character code. `/register?ref=CODE` counts a click and stores the code in a cookie for 30 days. At registration the code becomes tier 1, and its referrer becomes tier 2. When a bill settles, the tier 1 and tier 2 referrers earn stake × `affTier1Percent` (0.8%) and × `affTier2Percent` (0.2%). Members can move affiliate_balance to balance (min ฿1).
- **Vouchers:** a code with value, max uses, expiry, and once per user. Redeeming credits balance.
- **Bills:** placing one deducts the total stake atomically, and fails if the balance is too low. Cancel is allowed while the round is open and within `cancelWindowMin` (15) of placement; it refunds the stake and releases exposure. A cancelled round refunds every bill (status `refunded`).

## 6. Auth

Login by phone (10 digits starting with 0) or by username for admins, plus a password (min 8). Registration has 3 steps: phone plus OTP (demo shows the code), name plus password, then bank (bank code, account number of 10–15 digits, account name). Sessions use a random 32-byte token in the httpOnly cookie `cp_session` (sameSite lax, secure in production, 30 days). Only the SHA-256 of the token is stored. Passwords are hashed with scrypt. There are 5 failed logins per phone per 15 minutes before a lockout. Roles are `member` and `admin`. Suspended users can't log in.

Demo accounts (seeded and shown on the login page in demo mode): member `0812345678` / `demo1234` with ฿5,000; admin `admin` / `admin1234`.

## 7. Architecture

- **Next.js 16.4.5** App Router, using the scaffold defaults (`cacheComponents`, `partialPrefetching`, `reactCompiler`, Turbopack), with TypeScript strict, Tailwind v4, and React 19.3.
- **Cache Components rules:**
  - Every DB read goes through `src/server/data/*` loaders. Each loader starts with `await io()` (`next/cache`) unless it is intentionally wrapped in `use cache`.
  - Any component that awaits a loader or the session sits inside `<Suspense>` with a skeleton.
  - Layouts never await the session at the top level.
  - Mutations are Server Actions in `src/server/actions/*`. They re-check auth inside, return typed results, and call `refresh()`.
  - Route Handlers call `await connection()`.
- **DB:** `node:sqlite` `DatabaseSync` singleton on `globalThis`. The file comes from `DATABASE_PATH`, default `./data/chokprathan.db`. It runs WAL with foreign keys on. Migrations are versioned by `PRAGMA user_version`. A seed runs when there are no users.
- **Scheduler:** `src/instrumentation.ts` → `register()` → `startScheduler()` every 20s when `NEXT_RUNTIME === 'nodejs'`. The scheduler ensures rounds for today and tomorrow, generates auto results for rounds past their draw time, and settles them. Loaders call `tickIfStale(15s)` as a fallback.
- **Proxy:** `src/proxy.ts` makes an optimistic redirect to `/login?next=…` for member and admin paths with no session cookie. Real authorization happens in the DAL.
- **Libraries:** zod (input validation), lucide-react (icons), vitest (unit tests of pure domain logic). Nothing else unless a task justifies it.

## 8. Routes

Public and member pages share `src/app/(site)`. Auth pages are in `src/app/(auth)`, admin in `src/app/admin`.

`/` · `/lotto` · `/lotto/[roundId]` · `/results` · `/results/[lottoSlug]` · `/payrate` · `/rules` · `/promotions` · `/contact` · `/games` (category via `?category=`) · `/bills` · `/bills/[billId]` · `/wallet` · `/wallet/deposit` · `/wallet/withdraw` · `/wallet/transactions` · `/numbersets` · `/affiliate` · `/cashback` · `/vouchers` · `/account` · `/login` · `/register` · `/forgot-password` · `/admin` · `/admin/rounds` · `/admin/rounds/[roundId]` · `/admin/risk` · `/admin/lottos` · `/admin/members` · `/admin/members/[userId]` · `/admin/finance` · `/admin/promotions` · `/admin/vouchers` · `/admin/news` · `/admin/settings` · `/admin/audit`

## 9. Demo data

- The seeded catalog from §2, with rounds for the last 14 days (results generated and bills settled) plus today and tomorrow.
- 40 simulated members whose bills on today's open rounds create real exposure. At least one number per popular round is cut, and one is closed.
- The demo member gets 25 historical bills (won, lost, cancelled), transactions, a saved number set, two downline members, cashback, and affiliate income.
- 3 promotions, 2 vouchers (`WELCOME100`, `LUCKY50`), 3 news posts, and 24 mock games across casino, slot, and sport.
