# MongoDB for media, stats, and logs

Date: 2026-11-08. Chosen with the owner: option 1 of three (MongoDB for three things; bills and money stay in MariaDB; no bill archive, no Redis yet).

## Why

Expected load is 10,000+ bills a day (about 300k bills and 3M bill items a month). MariaDB handles that volume with the current indexes. Two things get slow as data accumulates:

1. The dashboard and the 11 reports re-aggregate raw `bills`, `bill_items`, `transactions` rows on every open, uncached. A month view scans millions of rows.
2. Slip and banner images live as MEDIUMBLOBs in MariaDB (`media`), so the database and its backups grow fastest from files.

Login history (`auth_log`) and referral clicks (`ref_clicks`) are write-heavy, money-free logs.

## Goals

- Dashboard, reports, and the member affiliate page answer from pre-built summaries, so their speed no longer depends on how many bills exist.
- Images and logs leave MariaDB.
- Every number stays identical to today's definitions (same filters, same time basis, same rounding).

## Non-goals

- Moving wallets, bills, bill items, exposures, transactions, deposits, withdrawals, promotions, rounds, users, or the staff audit log. Placing a bill locks the wallet row and per-number totals and writes five tables in one transaction; splitting that across databases risks double spending and overselling a capped number.
- Archiving old bills (revisit near 100k bills/day). Redis (revisit with several app servers).

## Constraints

- The cluster (DigitalOcean managed MongoDB 8.0, sgp1, single-node replica set) is shared with about 70 other sites' databases, and the given user has read/write on all of them. The app uses only its own database (`MONGODB_DB`, `chokprathan`), never runs database-level or admin commands besides `ping`, and never drops anything outside its own collections.
- Credentials only in `.env.local` / `.env.production.local` (`MONGODB_URL`, `MONGODB_DB`).
- Tests never touch this cluster: without `MONGODB_URL` (always the case under vitest) every feature uses the MariaDB path.
- MongoDB down or unset must never break a page: media, logs, and stats all fall back to MariaDB.
- App, MariaDB, and MongoDB in the same data center (Singapore).

## Design

### Connection (`src/server/mongo.ts`)

One `MongoClient` per process (cached on `globalThis` for dev reloads), lazy connect, short server-selection timeout. `mongoDb()` returns the app `Db` or `null` when unset or unreachable (a failed connect backs off for 30 s instead of retrying on every request). `ensureMongoIndexes()` runs at server start next to the MariaDB migration (same `DB_AUTO_MIGRATE` switch).

### Media (GridFS bucket `media`)

`saveImage` uploads to GridFS (`filename` = generated name, metadata `kind`, `ownerId`, `mime`, `createdAt`); if MongoDB is unavailable it writes the MariaDB row as today. `readImage` checks the in-process cache, then GridFS, then MariaDB (rows from before the switch). `removeImage` deletes from both. `npm run db -- media-to-mongo` copies existing MariaDB rows into GridFS and deletes each row once its copy is verified.

### Logs (`auth_log`, `ref_clicks` collections)

`authLog` and `recordRefClick` insert into MongoDB, falling back to the MariaDB tables. Readers (staff page sign-in list, staff report counts, affiliate click count) read MongoDB plus the MariaDB table (fallback and older rows) and merge. `auth_log` documents expire after 400 days (TTL on `atDate`).

### Stats

Grain: one Bangkok day (`d` = `floor((ms + offset) / DAY)`), with the same SQL filters the reports use today:

- `stats_days` (one document per day): placed bills by lotto (bills, stake, settled stake, payout, distinct round ids) on `created_at` with status pending/won/lost; 24 hourly placed totals; bet-type totals from `bill_items` of bills created that day; settled stake and payout on `settled_at` (won/lost) with 24 hourly values; transaction sums keyed `wallet:type` on `created_at`; approved deposits and withdrawals (count, sum, hourly) on `reviewed_at`; new members, referred members, first deposits (count, first approved amount).
- `stats_user_days` (one document per user per active day): bills, stake, settled stake, payout, lotto ids (for per-lotto distinct players), approved deposits and withdrawals, `aff_earn` received.
- `stats_rounds` (one document per settled or cancelled round): what the rounds report shows. Unsettled rounds in a range are still read live (few rows).

A closed day only changes when bills created that day change status. Every status change after placement sets `bills.settled_at` (settle, refund on round cancel, member cancel), so the rollup finds changed days with `SELECT DISTINCT day(created_at) FROM bills WHERE settled_at >= cursor - 10 min` (index `bills_settled`). Deposits, withdrawals, transactions, and members are stamped with the time they happen, so only today moves.

Rollup job (inside the scheduler lock, at most once a minute): rebuild today (and yesterday during the first 15 minutes after midnight), rebuild changed days (a few per tick), snapshot newly settled rounds, backfill missing days back to the first bill or member. Readers build any missing or stale day (today older than 3 minutes) on the spot, so results are correct even if the job is not running. Without MongoDB, readers build every day in the range in memory from MariaDB: the same numbers, today's cost. `npm run db -- stats-rebuild` rebuilds everything (for example after `seed-demo`).

Aggregation over a range: day documents are summed in JS (pure functions in `src/server/stats/derive.ts`, unit-tested); per-user totals (distinct players, top players, players report, top referrers, per-lotto players, downline turnover) use a MongoDB `$group` over `stats_user_days`, or the same grouping in JS in fallback mode.

Users of the summaries: dashboard KPIs, period-over-period change, charts, group split, top lottos, top players; reports `daily`, `lottos`, `rounds`, `bettypes`, `players`, `registrations`, `rewards`, and the staff report's sign-in counts; member affiliate page downline turnover. Live reads stay for the pending queue, open-round risk, member balances owed, health, and list reports (`finance`, `promotions`, `adjustments`).

Staleness: at most about a minute (plus one scheduler tick). The dashboard health card gains a MongoDB check.

## Left to the builder

Collection field names, bulk-write batching, and the exact backfill pace.
