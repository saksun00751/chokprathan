# Cache TTL audit (member site, before the admin Switch)

Plan: `docs/superpowers/plans/2026-11-20-chokprathan-admin-split.md`, Task 17. Spec §3 "Cache".

`src/server/cache.ts` keeps an in-process cache: `memo(key, ttlMs, load)` and `invalidate(...prefixes)`.
`invalidate()` clears only the process that calls it. Once the back office runs as its own app
(own process), a change it makes reaches the member site only when the member's entry expires.
The TTLs below are the member-side bound on that delay. All TTL constants live in
`src/server/cache-ttl.ts`; `src/server/cache-ttl.test.ts` fails if a safety key goes above 5 s or a
cosmetic key above 30 s.

## How this was collected

```bash
grep -rn "memo(" src --include='*.ts' | grep -v test
grep -rn "invalidate(" src --include='*.ts' | grep -v test
grep -rn "use cache\|cacheLife\|cacheTag\|updateTag\|revalidateTag" src
```

Each `invalidate(...)` call was traced back to its callers. "Admin write" means the call is reached from
`src/server/actions/admin.ts` (server actions behind `gate(...)`).

| invalidate call | prefixes | reached from (admin) |
|---|---|---|
| `services/settings.ts:69-70` `setSetting` | `settings`, `lobby`, `limits:` | `admin.ts` rates/risk/limits (194-196), site/wallet/rewards/points (689-692), theme (712), activities (931) |
| `services/lottos.ts:76-77` `invalidateLottos` | `lottos`, `lobby`, `limits:`, `results` | `saveLottoAction` (`admin.ts:251`) |
| `services/risk.ts:127-128` `setManualLimit` | `limits:<round>`, `lobby` | `setManualLimitAction` (`admin.ts:122`) |
| `services/rounds.ts:144-147` `invalidateRoundViews` | `lobby`, `results`, `limits:<round>` | `setResultAction` / bulk (`admin.ts:83,102`), `cancelRoundAction` (`admin.ts:114`); also the scheduler (`autoResults`) |
| `services/banners.ts:64-65` | `banners` | `saveBannerAction`, `deleteBannerAction`, move / image (`admin.ts:720-771`) |
| `actions/admin.ts:488` `contentChanged` | `content:` | `savePromotionAction` (523), `saveNewsAction` (599), `deleteNewsAction` (609) |
| `actions/admin.ts:945, 968` | `games:` | `syncGamesAction`, `setGameProductAction` |
| `services/scheduler.ts:118` | `games:` | scheduler daily catalog sync (not admin) |
| `services/rounds.ts:138` `ensureRounds` | `lobby` | scheduler (not admin) |
| `services/bills.ts:374, 419` | `limits:<round>` | member bets / cancels (not admin) |
| `services/settlement.ts:46` | `lobby`, `results`, `limits:<round>` | settlement after a result (admin result or scheduler) |
| `actions/admin.ts:714` `updateTag("theme")` | Next cache tag `theme` | `saveThemeAction` |

Not cached at all (always read from the database, so an admin change is seen at once):
blocklist (`services/blocklist.ts`: sign-in, register, withdraw checks query the table), member
status and sessions (`session.ts` -> `services/auth.ts`; blocking or closing a member revokes the
session rows), bank accounts shown for deposits (`services/banks.ts:60`), round status at bet time
(`bills.ts:278` reads the round `LOCK IN SHARE MODE`), manual limits and exposures at bet time
(`bills.ts:55, 111`), game product on/off at launch (`services/games.ts:347`).
There is no separate maintenance-mode flag; site switches (`registrationOpen`, `otpRequired`,
`cancelWindowMin`, announcement) are part of the `settings` key.

## Table

| key / prefix | where memoized | TTL | admin write that changes it | member-visible effect if stale | decision | reason |
|---|---|---|---|---|---|---|
| `settings` | `services/settings.ts:48` | 5 s (`SETTINGS_TTL_MS`) | rates, risk, bet limits, wallet limits, site switches (registration, OTP, cancel window, announcement), rewards, points, activities | **Correctness**: `placeBill` (`bills.ts:232, 267`) and bill cancel (`bills.ts:387`) read rates/limits/cancel window from it; wallet limits; registration open/closed | keep 5 s | Already at the 5 s cap. Read on nearly every page and every bet, so lower would multiply DB load; memo's bounded stale-while-revalidate keeps it cheap (worst case 10 s, see below). |
| `lottos` | `services/lottos.ts:73` | 5 s (`LOTTOS_TTL_MS`) | `saveLottoAction` (enable/disable, per-lotto rates/limits/risk, schedule) | **Correctness**: bet acceptance reads the lotto (`bills.ts:231, 271`) for rates and limits; a disabled lotto stays listed | keep 5 s | At the cap; hot (every page). Named the inline literal. |
| `lobby` | `data/lobby.ts:74` | 4 s (`LOBBY_TTL_MS`) | settings, lottos, manual limits, cancel round, results | Open rounds / cut counts shown on the home lobby; a cancelled round may stay listed up to ~4 s. Bet itself is re-checked in the DB | keep 4 s | Under the cap; hottest key. Named the inline literal. |
| `limits:<roundId>` | `services/risk.ts:99` | 3 s (`ROUND_LIMITS_TTL_MS`) | manual limits, risk/limits settings, lottos, results/cancel | Rate-cut and closed-number badges on the bet page. Bet acceptance reads `manual_limits`/`exposures` directly | keep 3 s | Under the cap. Named the inline literal. |
| `banners:active` | `services/banners.ts:70` | 10 s (`BANNERS_TTL_MS`) | banner save/delete/move/image | Old banner shown up to 10 s | keep 10 s | Cosmetic, under 30 s. (Plan step 2 listed banners with the 5 s group; the task brief classes them as cosmetic. 10 s kept; trivial to lower.) |
| `content:promotions` | `data/member.ts:52` | 15 s (`CONTENT_TTL_MS`) | `savePromotionAction` | Promotion list text/visibility up to 15 s old. The deposit page reads bonus promotions uncached (`data/wallet.ts:84`) | keep 15 s | Cosmetic. |
| `content:news` | `data/member.ts:77` | 15 s (`CONTENT_TTL_MS`) | `saveNewsAction`, `deleteNewsAction` | Old news shown up to 15 s | keep 15 s | Cosmetic. |
| `content:games` | `data/member.ts:90` | 60 s (inline) | none (no code writes table `games`; seed only). `contentChanged` would clear it but no admin action edits it | - | keep 60 s | Admin never writes it; not lowered per the rules. |
| `games:products` | `data/games.ts:31` | 60 s -> **30 s** (`GAME_PRODUCTS_TTL_MS`) | `setGameProductAction`, `syncGamesAction` | Switched-off product still listed; launching it is refused (`services/games.ts:351` re-reads the table) | lower to 30 s | Cosmetic, but above the 30 s cosmetic cap. |
| `games:catalog:<productId>` | `data/games.ts:56` | 60 s -> **30 s** (`GAME_CATALOG_TTL_MS`) | `syncGamesAction` (also the daily scheduler sync) | New/removed games in a product list | lower to 30 s | Cosmetic; same cap. Per-product key, up to 1000 rows, still cheap at 30 s. |
| `results:latest` | `data/lobby.ts:139` | 10 s (`RESULTS_TTL_MS`) | `setResultAction`, `cancelRoundAction`, `saveLottoAction` | A new result appears up to 10 s late. Payout happens in the DB regardless | keep 10 s | Display only. |
| `results:yiki` | `data/results.ts:17` | 10 s (`RESULTS_TTL_MS`) | same | same | keep 10 s | Display only. |
| `results:history:<lottoId>` | `data/results.ts:34` | 15 s (`RESULTS_HISTORY_TTL_MS`) | same | same | keep 15 s | Display only. |
| Next `use cache` tag `theme` | `theme.ts:15` (`cacheLife`) | 60 s -> **30 s** (`THEME_CACHE_S`) | `saveThemeAction` (`updateTag("theme")` is process-local too) | Old colour theme up to 30 s | lower to 30 s | Cosmetic cap. 30 s is also Next's floor for `stale` (below it the scope drops out of prefetching). |
| `proxy:<tokenHash>` | `proxy-auth.ts:18` | 5 s (inline) | none directly (reads `sessions`/`users`); revoking sessions changes the answer | Staff gate for `/admin` and the "session ended" note on `/login` | keep 5 s | Already 5 s. After the Switch member stops serving `/admin` (Task 14). Member pages check the session in the DB directly. |

## Bounded staleness (`STALE_BOUND_FACTOR`)

`memo` answers a stale entry at once and refreshes in the background (stale-while-revalidate), but
only while the entry is younger than `STALE_BOUND_FACTOR` (2) x its TTL (`src/server/cache.ts`).
Older than that, the caller waits for a fresh load; concurrent callers share that one load; if the
load fails the caller gets the error, as on a cold miss. Inside a transaction an expired entry is
still read on the transaction's own connection, uncached; with caching disabled (tests) every read
loads. `invalidate()` is unchanged. Tests: `src/server/cache.test.ts`.

Before this fix a key nobody had read for a while handed its first reader a value of any age (idle
entries are only swept when the cache holds more than 5000 keys): a quiet member process could have
accepted the first bet after an admin rate change at the old rate. Today that was hidden because the
admin runs in the same process and its `invalidate()` clears the entry; after the split it would not be.

### Worst-case staleness after an admin write (member process, no local invalidate)

"Busy" = read continuously, so a refresh starts as soon as the TTL passes: about one TTL (plus one
load). "Bound" = the hard ceiling from `STALE_BOUND_FACTOR`: 2 x TTL (plus one load). A key built
from other memo keys (nested) can add their staleness on top, because its load may itself be
answered a stale inner value.

| key | TTL | own: busy / bound | nested inside the load | data age, worst case (bound) | who relies on it |
|---|---|---|---|---|---|
| `settings` | 5 s | ~5 s / 10 s | - | 10 s | bet acceptance (rates, limits, cancel window), wallet limits, registration |
| `lottos` | 5 s | ~5 s / 10 s | - | 10 s | bet acceptance (lotto rates/limits, enabled) |
| `lobby` | 4 s | ~4 s / 8 s | `lottos`, `settings` (via `listLottos`, `getSettings`, `limitsForRounds`) | rounds 8 s; lotto/settings fields up to 8 + 10 = 18 s (busy: ~9 s) | home lobby display; bets re-checked in DB |
| `limits:<round>` | 3 s | ~3 s / 6 s | `settings`, `lottos` (in `limitsForRounds`) | 6 + 10 = 16 s (busy: ~8 s) | rate-cut badges (display); bets read `manual_limits`/`exposures` directly |
| `banners:active` | 10 s | ~10 s / 20 s | - | 20 s | display |
| `content:promotions`, `content:news` | 15 s | ~15 s / 30 s | - | 30 s | display |
| `games:products`, `games:catalog:<id>` | 30 s | ~30 s / 60 s | - | 60 s | display; launch re-checks DB |
| `results:latest` | 10 s | ~10 s / 20 s | `lottos` | 20 + 10 = 30 s | display |
| `results:yiki` | 10 s | ~10 s / 20 s | - | 20 s | display |
| `results:history:<id>` | 15 s | ~15 s / 30 s | - | 30 s | display |
| `proxy:<tokenHash>` | 5 s | ~5 s / 10 s | - | 10 s | staff `/admin` gate, "session ended" note |
| `content:games` | 60 s | ~60 s / 120 s | - | 120 s | display; admin never writes it |

Bet acceptance reads `settings` and `lottos` directly (not through `lobby`), so its worst case is
10 s, about 5 s on a busy site. If a hard 5 s ceiling is wanted for those two, set their TTLs to
2_500 ms (twice the queries) rather than changing the factor.

The theme is not a `memo` key: Next `use cache` with `cacheLife({ stale: 30, revalidate: 30,
expire: 86_400 })` also serves a stale entry while it regenerates, up to `expire`. A process idle for
hours can show the first visitor an old theme once. Cosmetic; left as is.

No cross-app invalidation was added (spec §3: only if short TTLs are not enough).
