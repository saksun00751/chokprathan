# SDD ledger — plan: docs/superpowers/plans/2026-11-08-mongodb.md
Spec: docs/superpowers/specs/2026-11-08-mongodb-design.md
Ruling: no git repository in this project — no worktree, commits, or BASE; this ledger plus test runs are the record — cost if wrong: no per-task diff ranges for review.
Pre-flight: T2,T3,T4,T6 consume T1 (mongoDb, COLL, MEDIA_BUCKET, mongoPing); T5 consumes T4 (store/derive) — names consistent, no conflicts.
Task 1: complete (tests: npx vitest run src/server/mongo.test.ts → 1 passed)
Task 2: complete (tests: npx vitest run src/server/media-store.test.ts → 5 passed; GridFS live check deferred to Task 7)
Task 3: complete (tests: npx vitest run src/server/logs.test.ts → 3 passed; server suite 16 passed)
Task 4: Ruling: loadDays passes load/save errors to the caller instead of building everything itself; rangeStats catches and builds the whole range in memory — one fallback path — cost if wrong: none (same numbers, MariaDB cost).
Task 4: Ruling: buildSpan(from,to) builds a run of days with one set of 14 grouped queries (plan said buildDay per day) — the no-MongoDB path then costs what the old range queries cost — cost if wrong: none.
Task 4: Ruling: affiliate all-time totals come from summaries only when the rollup has covered every past day and ran within 5 minutes, else MariaDB — avoids understated turnover during backfill — cost if wrong: slower affiliate page until backfill completes.
Task 4: complete (tests: npx vitest run src/server/stats → 20 passed; SQL ran read-only on MariaDB 10.5: 31 days in 746 ms; tsc 0 errors)
Task 5: Ruling: readers are wiring over the tested derive/load functions, no separate unit tests (plan had none) — verified by typecheck, build, and a live run in Task 7 — cost if wrong: a wiring slip shows wrong labels, caught at live run.
Task 6: complete (tests: npx vitest run src/i18n → 26 passed; docs updated)
Task 7: complete (vitest 142 passed / 54 skipped; eslint 0; next build OK 279 pages; live: stats-rebuild → indexes + 211 rounds in db chokprathan; GridFS round trip same bytes + removed; 30d stats 3.9 s first build, 0.3 s from MongoDB; MongoDB-down run fell back to MariaDB with no errors)
Final review: self-review (subagents are only used when the owner asks) — every metric re-checked against the old SQL filters: placed/settled/tx/money/series/groups/top lottos/top players/daily/lottos/rounds/bettypes/players/registrations/rewards/staff/affiliate all match.
Final: Ruling: no git, so no commits or finishing-a-development-branch step; this ledger stays as the record — cost if wrong: none.
Final: minor (deferred): first open of a long custom range right after enabling MongoDB on an install with long history builds and saves every missing day in that request (once); the rollup backfill normally fills history within about an hour.
Final: minor (deferred): if the rollup and a reader rebuild today at the same moment, a player's day can drop out until the next minute's rebuild.
Final: minor (deferred): while MongoDB is down, the first request in each 30-second window waits up to 5 s for the connection attempt.
