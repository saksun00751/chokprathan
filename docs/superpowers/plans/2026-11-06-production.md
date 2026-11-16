# Production readiness (MariaDB, RBAC, themes, dashboard, reports)

Request (2026-11-06): make the whole system really work on MariaDB, as secure and fast as possible,
with a full dashboard, 5 admin-selectable themes, staff permissions, and many reports.

## Decisions

- **DB:** mysql2 pool from `DATABASE_URL`, utf8mb4_unicode_ci, `decimalNumbers`, strict session sql_mode,
  READ COMMITTED (server binlog is MIXED, log_bin off), lock wait 10s, `-LOCAL_FILES`, `stringifyObjects`.
  `tx()` uses AsyncLocalStorage; nested calls join; deadlock/lock-timeout retry (1213/1205) at the outer level.
  `q/q1/run(sql, ...params)` keep the old variadic shape but are async.
- **Lock order (deadlock-free):** round row (S for bets/cancel, X for result/cancel-round) -> exposures (ODKU X, sorted keys)
  -> users (X, ascending id). Vouchers/deposits lock their own row first, then the user.
- **Settlement:** round marked resulted, then bills settled in chunks of 500 per transaction (set-based item updates,
  JS-computed ledger rows with exact balance_after, multi-row inserts). Scheduler resumes unsettled rounds.
- **Scheduler:** started from `src/instrumentation.ts` (not during `next build`), single runner via `GET_LOCK`.
- **Migrations:** `schema_migrations` table, statement arrays, `GET_LOCK` guarded, run at server start and via `npm run db:migrate`.
- **Seeds:** `essentials` (catalog, roles, default content, owner account; production defaults: demo off, crowd off,
  auto-approve off, auto results only for Yiki) and a small `demo` seed for staging only.
- **Tests:** need a disposable DB. Only `lotto_78` exists (no local MariaDB: Homebrew has no Intel bottles and building
  from source was blocked), so tests run against `TEST_DATABASE_URL` guarded by `ALLOW_DB_RESET` and refused when the
  DB is marked `install.mode = production`. Remote staging is wiped before the production install.
- **Media:** stored in DB (`media` MEDIUMBLOB) so several app instances work; banners public, slips need finance permission.
- **Caching:** in-process TTL + single-flight memo for settings/lottos (5s), lobby/results/limits (3-5s);
  invalidated in-process on writes. Theme via `'use cache'` + `cacheTag('theme')` + `updateTag`.
- **RBAC:** `users.role` = member | staff, `staff_roles.permissions` JSON; owner role has `*`.
  Every admin loader and action checks its permission; nav filtered. Staff sessions 12h + 2h idle, TOTP 2FA, auth_log.
- **Security:** headers + CSP without nonces (PPR), `poweredByHeader: false`, `__Host-` cookie in production,
  DB-backed rate limits (login, OTP, register, bets, vouchers, deposits), IP from `X-Real-IP` when `TRUST_PROXY=1`.

## Order

1. DB layer, schema, seeds, async port of services/loaders/actions, tests green on staging DB.
2. RBAC + staff management + 2FA + auth log.
3. Themes (5).
4. Dashboard (dataviz skill first).
5. Reports + CSV export.
6. Slip upload, OTP toggle + SMS adapter, bulk results, rate limits, security headers, caching.
7. Concurrency/load test script, deploy docs (Docker, PM2, nginx, `.env.example`).
8. Wipe staging, install production schema + essentials + owner on `lotto_78`, verify.
