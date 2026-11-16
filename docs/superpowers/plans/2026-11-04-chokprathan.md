# โชคประทาน Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete Thai online-lottery platform (member site + admin back office) on Next.js 16.4.5, with an automatic, configurable payout-rate reduction engine.

**Architecture:** Next.js App Router with Cache Components. All data lives in a `node:sqlite` file DB, reached only through server-side loaders (`io()` + Suspense) and Server Actions. Pure domain logic (bet types, number tools, matching, pricing tiers, schedules, money) lives in `src/domain` and is unit-tested. Services in `src/server/services` wrap DB transactions around it.

**Tech Stack:** Next.js 16.4.5, React 19.3, TypeScript strict, Tailwind CSS 4, node:sqlite, zod, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-chokprathan-design.md` (plus `PRODUCT.md`, `DESIGN.md`)

**Execution:** Native, inline. The user asked us to proceed without further review gates. There is no git repo (the user's setup) and no commit steps.

## Global Constraints

- Node ≥ 22.13 (node:sqlite). `engines` in package.json.
- Money is integer satang; stakes are whole baht; rates are integer rate×100. Never floats for stored money.
- All schedule math is in Asia/Bangkok (UTC+7, no DST). Store epoch ms.
- Every DB read for rendering goes through `src/server/data/*` and starts with `await io()`. Every component that awaits one sits inside `<Suspense>`. Never await cookies/session at a layout's top level.
- Every Server Action re-authenticates and authorizes. Admin actions also write `audit_log`.
- UI copy is Thai: no em dashes, verb + object buttons, no hype words. Colors are only the DESIGN.md tokens. Icons are lucide-react only.
- Touch targets ≥ 44px; focus-visible rings; `prefers-reduced-motion` respected.

## Review Focus

1. **Concurrent bets on the same number crossing a tier.** Exposure and segments must be computed inside the same transaction as the insert. Test: two sequential placements that straddle a threshold produce split segments and the exact total.
2. **Rate changed between quote and place.** Placement must refuse with `rate_changed` and a fresh quote, never pay a rate the member did not see. Test in bills service.
3. **Round closes while the slip is open.** Placement after `closesAt` returns `round_closed`; the UI shows it inline and keeps the slip. Test in bills service.
4. **Insufficient balance, or a stake over a limit.** Rejected with a specific reason and nothing deducted. Test in bills service.
5. **Settling twice, or cancelling after settlement.** Settlement is idempotent (only `pending` items), and cancel is refused once the round is closed. Test in bills service.

---

### Task 1: Foundation (deps, tokens, fonts, root layout, test runner)

**Files:**
- Modify: `package.json` (deps `zod lucide-react server-only`, dev `vitest`; scripts `test`, `test:watch`; `engines.node >=22.13`)
- Create: `vitest.config.ts` (node env, alias `@` → `src`)
- Modify: `src/app/globals.css` (Tailwind v4 `@theme` with DESIGN.md tokens as `--color-*`, radii, shadows, font; base styles: tabular nums utility `.tnum`, focus ring, reduced motion)
- Modify: `src/app/layout.tsx` (IBM Plex Sans Thai via `next/font/google`, `lang="th"`, metadata template `%s · โชคประทาน`, viewport themeColor)
- Create: `src/config/brand.ts` (`BRAND = { name: 'โชคประทาน', nameLatin: 'Chok Prathan', tagline, domain }`)
- Create: `src/components/brand/logo.tsx` (ticket-silhouette mark SVG + wordmark), `src/components/brand/guilloche.tsx` (procedural SVG hypotrochoid pattern, props `className`, `density`)

- [ ] `npm run build` passes on the placeholder page with the new layout; `npx vitest run` reports "no test files" without error.

### Task 2: Domain core (pure, TDD)

**Files:** `src/domain/{types,money,time,betTypes,numbers,match,pricing,schedule}.ts`, tests in `src/domain/*.test.ts`

**Interfaces (Produces):**
- `types.ts`: `BetTypeCode`, `ResultFormat = 'standard'|'thai_gov'|'laos4'`, `LottoGroup = 'thai'|'foreign'|'stock'|'yiki'`, `RoundResult { top3; bottom2; top4?; front3?: [string,string]; back3?: [string,string]; first6? }`, `Segment { stake: number; rate100: number }`, `RiskTier { threshold: number; percent: number }`, `RiskProfile { enabled: boolean; tiers: RiskTier[]; cap: number|null }`, `ManualLimit = {kind:'percent'; percent:number} | {kind:'closed'}`, `Schedule = {kind:'weekly'; days:number[]; close:'HH:MM'} | {kind:'monthly'; days:number[]; close:'HH:MM'} | {kind:'interval'; firstClose:'HH:MM'; everyMin:number; count:number}`
- `money.ts`: `formatBaht(satang, {sign?, decimals?})`, `formatRate(rate100)`, `payoutOf(segments): number /*satang*/`, `averageRate100(segments)`
- `time.ts`: `bkkParts(ms)`, `bkkMs(y,m,d,hh,mm)`, `dayKey(ms)`, `addDays(dayKey,n)`, `formatThaiDate(ms,'short'|'long')`, `formatClock(ms)`, `splitCountdown(ms)`
- `betTypes.ts`: `BET_TYPES` record (label, short, digits, defaultRate100, defaultMaxPerNumber, formats), `betTypesFor(format)`, `isValidNumber(code, n)`
- `numbers.ts`: `permutations(n)`, `nineteenDoors(d)`, `swipeFront(d)`, `swipeBack(d)`, `doubles()`, `triples()`, `uniq(list)`
- `match.ts`: `deriveResult(format, input) → {ok:true,result}|{ok:false,error}`, `isWinning(code, number, result)`
- `pricing.ts`: `priceStake({baseRate100, profile, manual, currentTotal, stake}) → {ok:true; segments} | {ok:false; reason:'closed'|'cap'; remaining:number}`, `marginalRate100(baseRate100, profile, manual, total) → number|null` (null = closed), `validateProfile(p) → string[]`
- `schedule.ts`: `closesForDay(schedule, dayKey) → number[]` (epoch ms, ascending), `previousClose(schedule, beforeMs) → number|null` (search ≤ 40 days back)

- [ ] Tests (written first, then implementation):
  - `permutations('123')` has 6 entries; `permutations('112')` → `['112','121','211']`; `nineteenDoors('5')` has 19 unique entries, all containing '5'; `swipeFront('3')` = `30..39`
  - `isWinning('tod3','321',{top3:'123',bottom2:'45'})` true; `isWinning('top2','23',…)` true; `isWinning('runBottom','5',…)` true; `isWinning('front3','111',{…front3:['111','222']})` true
  - `deriveResult('thai_gov',{first6:'123456',front3:['111','222'],back3:['333','444'],bottom2:'78'})` gives top3 `'456'`; `deriveResult('laos4',{top4:'4925'})` gives top3 `'925'`, bottom2 `'49'`; bad digits give `ok:false`
  - `priceStake` base 95000, tiers `[2000→75, 5000→50]`, cap 10000: T=1800, S=500 → segments `[{200,95000},{300,71250}]`; T=4900, S=200 → `[{100,71250},{100,47500}]`; T=9900, S=200 → `{ok:false, reason:'cap', remaining:100}`; manual percent 60 caps the first slice to 57000; manual closed → `{ok:false, reason:'closed', remaining:0}`; profile disabled → single segment at base
  - `payoutOf([{200,95000},{300,71250}])` = 200×95000 + 300×71250 satang
  - `closesForDay(yiki,'2026-11-04')` has 88 entries, the first is 06:00 BKK and the last is 03:45 on 11-05; weekly Mon/Wed/Fri on a Tuesday → `[]`; monthly `[1,16]` on the 16th → one close at 15:10
- [ ] `npx vitest run src/domain` all pass.

### Task 3: Database, migrations, seed

**Files:** `src/server/db/index.ts` (`getDb()`, `tx(fn)`), `src/server/db/migrations.ts`, `src/server/db/seed.ts` (`seedIfEmpty(db, now)`), `src/server/db/catalog.ts` (seed lotto types from spec §2)

**Tables:** `users` (id, phone unique, username unique null, password_hash, name, role, status, bank_code, bank_account, bank_name, ref_code unique, upline1_id, upline2_id, balance, cashback_balance, affiliate_balance, turnover_required, created_at), `sessions` (token_hash pk, user_id, expires_at), `login_attempts`, `otps`, `lottos` (id, slug, name, group, format, schedule_json, result_delay_min, auto_result, enabled, sort, rates_json, limits_json, risk_json), `rounds` (id, lotto_id, round_no, label, opens_at, closes_at, draw_at, status ['scheduled','resulted','cancelled'], result_json, resulted_at, unique(lotto_id, closes_at)), `bills` (id, code unique, user_id, round_id, total_stake, total_payout, status, created_at, settled_at), `bill_items` (id, bill_id, round_id, bet_type, number, stake, segments_json, rate100_avg, potential100, status, payout), `exposures` (round_id, bet_type, number, total_stake, pk triple), `manual_limits` (round_id, bet_type, number, kind, percent), `transactions`, `deposits`, `withdrawals`, `promotions`, `promotion_claims`, `vouchers`, `voucher_redemptions`, `number_sets`, `news`, `games`, `ref_clicks`, `settings` (key pk, value_json), `audit_log`.

- [ ] Vitest `db.test.ts` on `:memory:`: migrations run, `user_version` equals the migration count, and the seed creates the demo member with 500000 satang and the admin.

### Task 4: Services (auth, wallet, rounds, bills, risk, finance, retention, scheduler)

**Files:** `src/server/services/{auth,wallet,settings,lottos,rounds,risk,bills,finance,retention,scheduler}.ts`

**Interfaces (Produces):**
- auth: `hashPassword(p)`, `verifyPassword(p, h)`, `createSession(userId) → token`, `userFromToken(token)`, `revokeSession(token)`, `registerMember(input) → {ok,userId}|{ok:false,field,error}`, `checkLogin(identifier, password) → {ok,user}|{ok:false,error}`
- wallet: `move(userId, wallet:'balance'|'cashback'|'affiliate', amount, type, ref?, note?)` (throws `InsufficientFunds`)
- rounds: `ensureRounds(now, daysAhead=1)`, `roundStatus(round, now)`, `setResult(roundId, input, actorId)`, `cancelRound(roundId, actorId)`, `autoResults(now)`
- risk: `effectiveProfile(lotto, code)`, `manualLimitsFor(roundId)`, `setManualLimit(...)`, `limitsView(roundId) → { code, number, total, rate100|null }[]`
- bills: `quoteBill(userId, roundId, lines) → Quote`, `placeBill(userId, roundId, lines, {acceptChanges, expected}) → PlaceResult`, `cancelBill(userId, billId, now)`, `settleRound(roundId)`
- finance: `requestDeposit`, `confirmDeposit`, `reviewDeposit`, `requestWithdrawal`, `reviewWithdrawal`
- retention: `claimCashback`, `transferAffiliate`, `redeemVoucher`, `recordRefClick`
- scheduler: `tick(now)`, `tickIfStale(maxAgeMs)`, `startScheduler()`

- [ ] Tests `bills.test.ts` (in-memory DB): place → balance decreases by the stake and exposure increases; a crossing threshold yields split segments; `rate_changed` when `expected` differs; `round_closed` after closesAt; `insufficient_balance`; settle pays the winners exactly, credits cashback on losers, credits affiliate tiers, and is idempotent; cancel refunds and releases exposure, and is refused after close.

### Task 5: Auth flow, proxy, DAL, shell

**Files:** `src/proxy.ts`, `src/server/session.ts` (`getViewer()` with React `cache`), `src/server/data/*.ts`, `src/server/actions/auth.ts`, `src/app/(auth)/{layout,login/page,register/page,forgot-password/page}.tsx`, `src/app/(site)/layout.tsx`, `src/components/shell/*` (Header, Sidebar, BottomNav, BalancePill, AccountMenu), `src/components/ui/*` (Button, Input, Field, Badge, Card, Sheet, Tabs, Skeleton, EmptyState, Toast, Countdown, Money, RateChip, TicketDivider)

- [ ] The dev server shows login; the demo member logs in and the header shows the balance; logout works; `/bills` without a session redirects to `/login?next=/bills`.

### Task 6: Home, lobby, bet page

**Files:** `src/app/(site)/page.tsx`, `src/app/(site)/lotto/page.tsx`, `src/app/(site)/lotto/[roundId]/page.tsx`, `src/components/lotto/*` (RoundCard, LobbyFilters, BetComposer, NumberPad, PanelGrid, ToolBar, Slip, ConfirmSheet), `src/app/api/rounds/[roundId]/limits/route.ts`, `src/server/actions/bills.ts`

- [ ] A Playwright script at 390 and 1440 does: login → lobby → open a round → add numbers via the keypad, 19 ประตู, and กลับเลข → set stakes → confirm → success with the bill code; then a cut-rate number shows its reduced rate before confirming.

### Task 7: Bills, results, pay rates, rules

**Files:** `src/app/(site)/bills/{page,[billId]/page}.tsx`, `src/app/(site)/results/{page,[lottoSlug]/page}.tsx`, `src/app/(site)/payrate/page.tsx`, `src/app/(site)/rules/page.tsx`

- [ ] Screenshots at 390 and 1440 show real seeded data; cancelling an open bill refunds it.

### Task 8: Wallet, retention, account, games, contact

**Files:** `src/app/(site)/wallet/{page,deposit/page,withdraw/page}.tsx`, `affiliate`, `cashback`, `vouchers`, `promotions`, `numbersets`, `account`, `games/{page,[category]/page}`, `contact` pages; `src/server/actions/{wallet,retention,account,numbersets}.ts`

- [ ] Deposit ฿500 credits the balance (auto-approve on); withdraw ฿100 creates a pending request; `WELCOME100` redeems once; claiming cashback and transferring affiliate income move money between wallets.

### Task 9: Admin

**Files:** `src/app/admin/layout.tsx` + pages from spec §8, `src/components/admin/*`, `src/server/actions/admin/*.ts`

- [ ] Admin logs in; enters a Thai-gov result and the bills settle; edits the top3 risk tiers and the bet page reflects the new rate within 15s; adds a manual อั้น; approves a pending withdrawal; the audit log lists all of these actions.

### Task 10: PWA, SEO, README, final QA

**Files:** `src/app/manifest.ts`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`, `README.md`

- [ ] `npm run lint`, `npx vitest run`, and `npm run build` are clean; `next start` shows no console errors at 390/768/1440 on home, lobby, bet, bills, wallet, results, and admin.
