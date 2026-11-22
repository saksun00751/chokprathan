# Admin-Split Cut-Over Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan touches production.** Every task that runs a command against the production database, the production host, or production DNS/reverse-proxy is marked **PRODUCTION — STOP, confirm with the owner before running**. Do not run those steps unattended. Tasks without that marker are local/repo-only and safe to run without asking again.

**Goal:** Finish moving the back office from `chokprathan` (member repo) to `chokprathan-admin`, so the member app no longer serves `/admin` or `/console` in production, with zero data loss and a working rollback path until the contract step.

**Current state (verified 2026-11-23):**
- All code for Phase A (Tasks 1–12, 16, 17) is committed and done in `chokprathan-admin` (`main`, commit `3085e99`).
- All code for Phase B's two code tasks is **already written and verified**, on branch `admin-split/cutover` of `chokprathan` (member repo), **not yet merged to `main`**:
  - tag `admin-split-switch` = Task 14 done (member no longer has `/admin`, `/console`, staff auth, or back-office scheduler jobs).
  - tag `admin-split-contract` (two commits after `admin-split-switch`) = Task 15 done (migration 9: drops staff rows from `users`, keeps `role` and `staff_note`).
  - Rebased onto current `main` (Task 2, done), and `npm run build`, `npm run typecheck`, `npm run lint` all pass clean on the rebased branch. `scripts/check-parity.sh` and `node scripts/check-grants.mjs` (run from `chokprathan-admin`) both print `ok`. **Not yet run:** `npm test` for either repo — both need a disposable MariaDB (`TEST_DATABASE_URL`), which this sandbox does not have (no local MariaDB superuser available). Run it wherever one exists before Task 7.
- Nothing in the production runbook (`chokprathan-admin/docs/runbook-cutover.md`) has been executed yet — no backup, no grants applied, no deploy.
- **No production server exists yet, and the reverse proxy is not decided** (confirmed with the owner 2026-11-23 — it is *not* nginx). The repo's old `deploy/nginx.conf` template has been removed from both the plan and `main`; `DEPLOY.md` §5 now states proxy-agnostic requirements instead. Task 1 below is to decide and document the real one — do this before Task 7, not before.
- Housekeeping gap found and fixed: the member repo's `Dockerfile`/`docker-compose.yml`/`.dockerignore` were removed from `main` in this session; `admin-split/cutover` has been rebased to pick that up (Task 2, done).

**Architecture:** No new code paths. This plan sequences existing, already-tested commits through the existing runbook (`chokprathan-admin/docs/runbook-cutover.md`), which stays the source of truth for the exact SQL/backup/verify commands in Pre-flight through Contract. This plan adds the tasks the runbook assumes are already done (infra prep, merging the right commit at the right time) and gives the exact go/no-go checkpoints.

**Tech Stack:** Next.js 16.4.5 (both repos), MariaDB 10.5+, MongoDB 7.8, PM2, reverse proxy TBD.

---

### Task 1: Decide and document the reverse proxy (local + one owner decision)

**Done so far:** the stale nginx-only template is gone from both repos' docs (`chokprathan/DEPLOY.md` §5 now lists proxy-agnostic requirements). What's left is an actual decision — nothing further can be prepared generically until it's made, since the exact config syntax (and where maintenance-mode and the admin upstream live) depends on which proxy is chosen.

**Files:**
- Create, once decided: `chokprathan/deploy/<proxy-name>.conf` (or equivalent) and, if admin needs its own instance config, `chokprathan-admin/deploy/<proxy-name>.conf`.
- Modify: `chokprathan/DEPLOY.md` §5, `chokprathan-admin/README.md` deploy section.

- [ ] **Step 1: Owner decides** which reverse proxy fronts both apps in production (Caddy, a cloud load balancer, direct TLS termination in Next.js, etc.) and whether `chokprathan` and `chokprathan-admin` share one proxy instance or each gets its own.
- [ ] **Step 2: Write the config** for that proxy covering the same requirements DEPLOY.md §5 lists (HTTPS, per-IP and tighter per-POST rate limits, `X-Real-IP`/`X-Forwarded-For` overwritten with `TRUST_PROXY=1` set in both apps' env, 4 MB upload cap, no HTML caching) plus:
  - a route to `chokprathan` on `127.0.0.1:3000` (member) and `chokprathan-admin` on `127.0.0.1:3100` (admin), on whatever domains/subdomains are chosen
  - a maintenance-mode toggle usable during Task 8 (Switch) — e.g. a file check returning 503, or the proxy's own equivalent
  - optionally, an IP allowlist for the admin domain
- [ ] **Step 3: Commit it** in the relevant repo(s) and update `DEPLOY.md` §5 / the admin `README.md` to reference the real file instead of "ยังไม่ตัดสินใจ".

---

### Task 2: Confirm parity and grants are still clean (local, repo-only) — done 2026-11-23

Ran from `chokprathan-admin` against the rebased `admin-split/cutover` branch of `chokprathan`:

```bash
cd /Users/mckazine/Desktop/chokprathan-admin
scripts/check-parity.sh /Users/mckazine/Desktop/chokprathan        # -> parity ok
node scripts/check-grants.mjs --member /Users/mckazine/Desktop/chokprathan   # -> grants ok
```
Both passed. `chokprathan` (member, `admin-split/cutover`) also passed `npm run build`, `npm run typecheck`, `npm run lint` after the rebase. `npm test` for both repos is still outstanding (no disposable MariaDB in this sandbox) — run it before Task 6.

No further action needed unless either script starts failing after a future change to either repo.

---

### Task 3: Fill in the real production variables (local, repo-only — no production access needed yet)

**Files:**
- Create (not committed — see Step 2): a local notes file, e.g. `~/chokprathan-cutover-vars.sh`, **outside both repos**, never added to git.

- [ ] **Step 1: Collect the real values** for every variable the runbook (`chokprathan-admin/docs/runbook-cutover.md`, top "ตัวแปรที่ใช้ทั้งเอกสาร" block) and the admin `.env.example` ask for:
  - `DB_HOST`, `DB` (database name — confirm it's `lotto_78`, not the placeholder `lotto` the runbook uses; adjust every `$DB` reference accordingly when running commands)
  - A **new, privileged** MariaDB user for `MIGRATE_URL` (DDL rights) — create it now if it doesn't exist; this user must **never** be used as the running app's `DATABASE_URL`
  - `chok_admin` / `chok_member` passwords for `ADMIN_URL` / `MEMBER_URL` (create these DB users in Task 5 — the passwords just need to be decided now)
  - The real office/admin IP for whatever allowlist/maintenance-mode mechanism Task 1's proxy choice ends up using
  - `ADMIN_DIR=/srv/chokprathan-admin`, `MEMBER_DIR=/srv/chokprathan` (or wherever the production checkouts live — confirm with whoever has server access, since this session has none)

- [ ] **Step 2: Write them to a local shell file that is never committed**, e.g.:

```bash
cat > ~/chokprathan-cutover-vars.sh <<'EOF'
export DB=lotto_78
export ADMIN_DIR=/srv/chokprathan-admin
export MEMBER_DIR=/srv/chokprathan
export MIGRATE_URL='mysql://MIGRATE_USER:REPLACE_ME@REPLACE_HOST:3306/lotto_78'
export ADMIN_URL='mysql://chok_admin:REPLACE_ME@REPLACE_HOST:3306/lotto_78'
export MEMBER_URL='mysql://chok_member:REPLACE_ME@REPLACE_HOST:3306/lotto_78'
EOF
chmod 600 ~/chokprathan-cutover-vars.sh
```
This file is sourced (`source ~/chokprathan-cutover-vars.sh`) at the start of every later task in this plan that needs those variables. Never paste real passwords into chat or into a committed file.

---

### Task 4: PRODUCTION — Backup and pre-flight checks

**PRODUCTION — STOP, confirm with the owner before running.** This is the first task that touches the live server/database.

- [ ] **Step 1:** On the production host (or a machine with DB access), run runbook §1 "Pre-flight" steps 1–4 exactly as written in `chokprathan-admin/docs/runbook-cutover.md`:
  - full + table backup (`mysqldump` commands, §1.1)
  - the `actor_id`/`created_by`/`reviewed_by`/`resulted_by`/`archived_by`/`closed_by` staff-id consistency check (§1.2) — **must return `Empty set`**
  - record the staff/roles counts (§1.3)
  - optional early FK check (§1.4)
- [ ] **Step 2:** Confirm the runbook's own **Verify** line for this section: two non-zero-size backup files, `Empty set` from step 2, counts recorded.
- [ ] **Step 3:** Report the backup file paths and sizes, and the staff/roles counts, before moving to Task 6.

---

### Task 5: PRODUCTION — Expand (schema + DB users, app unaffected)

**PRODUCTION — STOP, confirm with the owner before running.**

- [ ] **Step 1:** Run runbook §2 "Expand" in order: member migrate with `MIGRATE_URL` → admin tables migrate → `import-staff` → apply `scripts/grants.sql` (adjusted for `$DB=lotto_78`, see Task 4 step 1).
- [ ] **Step 2:** Runbook's own Verify line for this section must pass before continuing. The member app is still running unchanged throughout — this step only adds tables/users, it does not remove anything.

---

### Task 6: PRODUCTION — Deploy chokprathan-admin (parallel run)

**PRODUCTION — STOP, confirm with the owner before running.**

- [ ] **Step 1:** Build and deploy `chokprathan-admin` (`main`, commit `3085e99` or later) to the production host per its `README.md` (npm ci, build, copy `.next/static`, PM2 start via `ecosystem.config.cjs`, port 3100).
- [ ] **Step 2:** Apply Task 1's reverse-proxy config to production (routing the admin domain to `127.0.0.1:3100`) and reload/apply it per that proxy's own command.
- [ ] **Step 3:** Sign in to the admin app's `/console` at whatever domain was configured, with an existing staff account (imported by Task 5's `import-staff`), and confirm the back office loads and a known-good page (e.g. dashboard) renders real data.
- [ ] **Step 4:** Leave both apps running in parallel (member still serves `/admin` and `/console` too, at this point) for whatever soak period the owner wants before Switch. Do not proceed to Task 7 without the owner's go-ahead — this is the runbook's "Parallel run" phase, meant to be watched for a while, not rushed.

---

### Task 7: PRODUCTION — Switch

**PRODUCTION — STOP, confirm with the owner before running.** This is the point of no easy return for staff logins (rollback is still possible per the runbook until Contract, but requires redeploying the old member build).

- [ ] **Step 1:** Deploy `chokprathan` at tag `admin-split-switch` (already rebased, Docker-free, build/typecheck/lint clean as of Task 2) to the production member host, with `DB_AUTO_MIGRATE=false` already set per runbook §0 item 1 and §0 item 10.
- [ ] **Step 2:** Enable the maintenance-mode toggle from Task 1's proxy config briefly if the owner wants a hard cutover moment; otherwise rely on the new build simply 404-ing `/admin` and `/console` (per `isRemovedPath` in the Task 14 code) once deployed.
- [ ] **Step 3:** Confirm staff can no longer reach `/admin` or `/console` on the member domain (expect 404), and **can** sign in and work normally at the admin app's domain.
- [ ] **Step 4:** Confirm member-site customer flows (login, betting, wallet) still work — the scheduler jobs member kept (`pruneSessions`, `pruneRateLimits`, `syncCatalog`, `closeGameDay`) are running, and the ones it dropped are now only running from the admin app's scheduler.
- [ ] **Step 5:** Merge `admin-split/cutover` up to `admin-split-switch` into `chokprathan`'s `main` now that it's live, so `main` matches what's deployed:
```bash
cd /Users/mckazine/Desktop/chokprathan
git checkout main
git merge --ff-only admin-split-switch
git push origin main --tags
```

---

### Task 8: PRODUCTION — Contract (1–2 weeks after Switch, per the plan's own timeline)

**PRODUCTION — STOP, confirm with the owner before running.** Irreversible: deletes staff rows from `users`.

- [ ] **Step 1:** Re-run the pre-check from Task 5 step 1 (the `actor_id`/`created_by`/… staff-id query) — must still return `Empty set`. If any new staff-id references were written to `users`-keyed columns since Switch, resolve them first.
- [ ] **Step 2:** Deploy `chokprathan` at tag `admin-split-contract` and run migration 9 with the **privileged** `MIGRATE_URL` (never the running app's `chok_member` user, which has no DDL rights) per runbook §0 item 10 and §6.
- [ ] **Step 3:** Confirm `npm run db -- status` reports schema version 9, and that `staff_roles` no longer exists while `users.role` and `users.staff_note` are unchanged.
- [ ] **Step 4:** Merge `admin-split/cutover` the rest of the way into `main`:
```bash
cd /Users/mckazine/Desktop/chokprathan
git checkout main
git merge --ff-only admin-split-contract
git push origin main --tags
git branch -d admin-split/cutover
git push origin --delete admin-split/cutover
```
- [ ] **Step 5:** Tell the system owner and any auditors (per runbook §0 item 6) that staff sign-in history before the Switch date lives only in the member's old `auth_log` (MariaDB table, now read-only/archived, and Mongo `auth_log`), while everything from Switch onward is in `chokprathan-admin`'s `employee_auth_log`.

---

## Self-Review

**Spec coverage:** every remaining runbook phase (Pre-flight, Expand, Parallel run, Switch, Contract) has a task (4, 5, 6, 7, 8); the reverse-proxy decision this needed (nginx was assumed, then ruled out) has its own task (1, still open); readiness was verified locally (2, done; 3 still needed for the real production values).

**Known limitations to tell the owner:**
- This plan cannot execute Tasks 4–8 itself — they need a shell on the production host, which this session does not have. Hand those tasks to whoever has server access, or re-run this session with that access, task by task, confirming before each PRODUCTION step.
- Task 1 (reverse proxy) is a real open decision, not busywork — Tasks 6 and 7 both depend on it being made and deployed first.
- Tags `admin-split-switch`/`admin-split-contract` were moved twice during this session's rebase. If anyone already has a local checkout of the old hashes, tell them to re-fetch before Task 7/8.
- `npm test` has not been run on either repo since the rebase (no disposable MariaDB available in this sandbox) — run it before Task 6.
