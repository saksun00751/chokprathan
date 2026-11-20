# chokprathan-admin Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the back office into a new project `chokprathan-admin` that uses the same MariaDB but its own `employee_*` tables, its own DB user, session cookie, scheduler lock and deployment.

**Architecture:** Two Next.js 16 apps, one database. The admin repo owns `employee_roles`, `employees`, `employee_sessions`, `employee_session_ends`, `employee_login_challenges`, `employee_login_attempts`, `employee_auth_log` and (by permission) `audit_log`. Staff rows are copied from `users` keeping their ids, so every historical `actor_id` / `created_by` stays valid. Code the admin needs is copied (not shared). Work is split into an additive phase (Tasks 1–12, nothing changes for users) and a cut-over phase (Tasks 13–16). Task 17 (member cache TTL audit) is listed last for numbering only: do it **before** the Switch step of Task 13.

**Tech Stack:** Next.js 16.4.5 (read `node_modules/next/dist/docs/` before changing routing/proxy code, per AGENTS.md), React 19, TypeScript, mysql2 + MariaDB 10.5+, `mongodb` 7.8 (media/stats), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-chokprathan-admin-split-design.md`

## Global Constraints

- Admin repo path: `/Users/mckazine/Desktop/chokprathan-admin` (sibling of the member repo, called `$MEMBER` below = `/Users/mckazine/Desktop/chokprathan`, `$ADMIN` = the new repo).
- Never edit a shipped migration; append only. Member's last migration is **8**; the contract migration is **9**.
- Staff ids are preserved: `employees.id = users.id`. Do not renumber.
- Database tests need a disposable MariaDB: `TEST_DATABASE_URL` (existing convention; every run wipes it). Admin tests that need the legacy `users` table create it themselves in the test (see Task 4).
- Every new env var goes in `.env.example`. Secrets never go in git.
- Admin does **not** receive the AMB (aggregator) secrets (`src/server/amb*.ts`, `AMB_*` env). Task 8 enforces this with a grep check.
- Run `npm test`, `npm run typecheck`, `npm run lint` in the repo you changed before every commit that ends a task.

## Review Focus

1. `importStaff` keeps ids and is idempotent; a re-run with `refresh` picks up changes (Task 4).
2. `chok_member` cannot read `employee_*` / `audit_log`; `chok_admin` cannot touch unlisted tables (Task 10).
3. Money logic parity between repos (Task 11).
4. The scheduler lock names differ, and `SCHEDULER=off` really stops the loop (Task 9).
5. Cut-over order: member must stop serving `/admin` and the staff cookie only after the admin app is live (Tasks 13–14).

## File Structure ($ADMIN)

| Path | Responsibility |
|---|---|
| `src/server/db/index.ts` | pool, `q/q1/run/tx/withLock` (copied unchanged from member) |
| `src/server/db/migrations.ts` | admin-owned schema (`employee_*`) |
| `src/server/db/migrate.ts` | runner using its own `schema_migrations_admin` table and lock `chokprathan-admin:migrate` |
| `src/server/db/import-staff.ts` | copy staff from `users`/`staff_roles` into `employees`/`employee_roles` (keep ids) |
| `src/server/services/employee-auth.ts` | passwords, sessions, login checks, 2-step, session ends |
| `src/server/services/employees.ts` | staff management (ported from member `services/staff.ts`) |
| `src/server/services/audit.ts`, `audit-chain.ts` | copied; `actor_id` = employee id |
| `src/server/session.ts` | `getEmployee`, `requireEmployee`, `employeeFor`, cookie helpers |
| `src/proxy.ts` | locale + employee gate |
| `src/app/[lang]/login/*` | sign-in page and 2-step form |
| `src/app/[lang]/(panel)/**` | the 26 pages, moved from `admin/*` |
| `src/app/media/[name]/route.ts` | slips for employees with `finance.view` |
| `scripts/grants.sql` | DB users and GRANTs |
| `docs/runbook-cutover.md` | the production switch, step by step |

---

## Phase A — Additive (users notice nothing)

### Task 1: Scaffold the admin repo

**Files:** Create `$ADMIN/*` (copied config), `$ADMIN/package.json`, `$ADMIN/.env.example`, `$ADMIN/AGENTS.md` (copied).

- [ ] **Step 1: Create the repo and copy config**

```bash
mkdir -p /Users/mckazine/Desktop/chokprathan-admin && cd /Users/mckazine/Desktop/chokprathan-admin && git init -b main
M=/Users/mckazine/Desktop/chokprathan
cp $M/{tsconfig.json,eslint.config.mjs,.prettierrc,vitest.config.mts,next.config.ts,AGENTS.md,.gitignore,.dockerignore,Dockerfile,ecosystem.config.cjs} .
mkdir -p src/test src/server/db src/server/services src/domain src/i18n deploy scripts docs
cp $M/src/test/*.ts src/test/
cp $M/src/server/db/index.ts src/server/db/index.ts
cp $M/src/server/cache.ts $M/src/server/csv.ts $M/src/server/totp.ts $M/src/server/totp.test.ts $M/src/server/request.ts src/server/
```

- [ ] **Step 2: Write `package.json`** (same dependency versions as the member repo, new name, no `qrcode` removal — the security page needs it)

```bash
node -e '
const p=require("'$M'/package.json");
p.name="chokprathan-admin";
p.scripts.db="tsx --conditions=react-server --env-file-if-exists=.env.local scripts/db.ts";
delete p.scripts.loadtest;
require("fs").writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");
'
npm install
```

- [ ] **Step 3: Write `.env.example`**

```bash
cat > .env.example <<'EOF'
# MariaDB: use the chok_admin user (see scripts/grants.sql). Same database as the member site.
DATABASE_URL=mysql://chok_admin:change-me@127.0.0.1:3306/lotto
DATABASE_POOL_SIZE=20
# "off" keeps the background scheduler from running (used while the old app still owns it).
SCHEDULER=on
# Same MongoDB as the member site (media, stats). Optional.
# MONGODB_URL=
# MONGODB_DB=chokprathan
NEXT_PUBLIC_SITE_URL=https://admin.example.com
TRUST_PROXY=1
EOF
```

- [ ] **Step 4: Verify nothing is broken yet and commit**

Run: `npm run typecheck`
Expected: errors only about files that do not exist yet (`@/server/...` imports in copied files). Fix by deleting from `src/server/request.ts` nothing — it imports `ClientInfo` from `@/server/services/auth`; change that import to `@/server/services/employee-auth` (created in Task 5) and accept the typecheck error until Task 5.

```bash
sed -i '' 's#@/server/services/auth#@/server/services/employee-auth#' src/server/request.ts
git add -A && git commit -m "chore: scaffold chokprathan-admin"
```

### Task 2: Admin migration runner

**Files:** Create `$ADMIN/src/server/db/migrate.ts`, `$ADMIN/src/server/db/migrations.ts`. Test: `$ADMIN/src/server/db/migrate.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/db/migrate.test.ts
import { describe, expect, it } from "vitest";
import { hasTestDb } from "@/test/db";
import { q1 } from "@/server/db";
import { migrate, schemaVersion } from "@/server/db/migrate";

describe.skipIf(!hasTestDb)("admin migrations", () => {
  it("creates the employee tables and is safe to run twice", async () => {
    await migrate();
    expect(await migrate()).toBe(0);
    expect(await schemaVersion()).toBeGreaterThanOrEqual(1);
    for (const t of ["employees", "employee_roles", "employee_sessions", "employee_session_ends", "employee_login_challenges", "employee_login_attempts", "employee_auth_log"]) {
      expect(await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", t), t).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '@/server/db/migrate'`)

Run: `npx vitest run src/server/db/migrate.test.ts`

- [ ] **Step 3: Write `migrations.ts`**

```ts
// src/server/db/migrations.ts
/**
 * Admin-owned schema. Append only. The member app never touches these tables.
 * Times are epoch ms. Staff ids are copied from `users.id` (see import-staff.ts), so `employees.id`
 * is also the value historical `actor_id` / `created_by` columns hold.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const T = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "employee schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS employee_roles (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        description VARCHAR(200) NOT NULL DEFAULT '',
        permissions TEXT NOT NULL,
        is_owner TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY employee_roles_name (name)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employees (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(40) NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        name VARCHAR(100) NOT NULL DEFAULT '',
        status ENUM('active','suspended') NOT NULL DEFAULT 'active',
        employee_role_id INT NULL,
        totp_secret VARCHAR(64) NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        totp_last_step BIGINT NULL,
        must_change_password TINYINT(1) NOT NULL DEFAULT 0,
        note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT NULL,
        last_ip VARCHAR(45) NULL,
        UNIQUE KEY employees_username (username),
        CONSTRAINT employees_role_fk FOREIGN KEY (employee_role_id) REFERENCES employee_roles (id)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employee_sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        employee_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        KEY employee_sessions_employee (employee_id),
        KEY employee_sessions_expires (expires_at),
        CONSTRAINT employee_sessions_fk FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employee_session_ends (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        employee_id INT NOT NULL,
        reason VARCHAR(20) NOT NULL,
        ended_at BIGINT NOT NULL,
        by_ip VARCHAR(45) NULL,
        KEY employee_session_ends_at (ended_at),
        KEY employee_session_ends_employee (employee_id)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employee_login_challenges (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        employee_id INT NOT NULL,
        next_path VARCHAR(200) NOT NULL DEFAULT '/',
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        KEY employee_login_challenges_expires (expires_at),
        CONSTRAINT employee_login_challenges_fk FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employee_login_attempts (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        identifier VARCHAR(100) NOT NULL,
        ip VARCHAR(45) NULL,
        at BIGINT NOT NULL,
        KEY employee_login_attempts_ident (identifier, at),
        KEY employee_login_attempts_ip (ip, at)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS employee_auth_log (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NULL,
        identifier VARCHAR(100) NULL,
        event VARCHAR(30) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        KEY employee_auth_log_employee (employee_id, created_at),
        KEY employee_auth_log_created (created_at)
      ) ${T}`,
    ],
  },
];

/** Every table this app creates, children first (tests truncate and drop in this order). */
export const APP_TABLES = [
  "employee_auth_log",
  "employee_login_attempts",
  "employee_login_challenges",
  "employee_session_ends",
  "employee_sessions",
  "employees",
  "employee_roles",
  "schema_migrations_admin",
] as const;
```

- [ ] **Step 4: Write `migrate.ts`**

```ts
// src/server/db/migrate.ts
import "server-only";
import { pinned, q, q1, run, withLock } from "./index";
import { APP_TABLES, MIGRATIONS } from "./migrations";

/** Apply pending admin migrations. Own version table and lock: never collides with the member app's migrator. */
export async function migrate(log: (line: string) => void = () => {}): Promise<number> {
  const result = await withLock(
    "chokprathan-admin:migrate",
    async () => {
      await run(`CREATE TABLE IF NOT EXISTS schema_migrations_admin (
        version INT NOT NULL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        applied_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const done = new Set((await q<{ version: number }>("SELECT version FROM schema_migrations_admin")).map((r) => r.version));
      let applied = 0;
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        for (const statement of m.statements) await run(statement);
        await run("INSERT INTO schema_migrations_admin (version, name, applied_at) VALUES (?, ?, ?)", m.version, m.name, Date.now());
        log(`[db] admin migration ${m.version} applied: ${m.name}`);
        applied++;
      }
      return applied;
    },
    60,
  );
  if (!result.ran) throw new Error("Another process is migrating the database; gave up after 60 seconds");
  return result.value;
}

export async function schemaVersion(): Promise<number> {
  const exists = await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations_admin'");
  if (!exists) return 0;
  return (await q1<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations_admin"))?.v ?? 0;
}

/** Test databases only: drops the admin tables. Refuses unless ALLOW_DB_RESET is set. */
export async function dropAppTables(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== "yes-destroy-data") throw new Error("Refusing to drop tables: set ALLOW_DB_RESET=yes-destroy-data");
  await pinned(async () => {
    await run("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of APP_TABLES) await run(`DROP TABLE IF EXISTS ${table}`);
    } finally {
      await run("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}

/** Test databases only: empties the admin tables, keeping the schema. */
export async function truncateAppTables(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== "yes-destroy-data") throw new Error("Refusing to truncate: set ALLOW_DB_RESET=yes-destroy-data");
  await pinned(async () => {
    await run("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of APP_TABLES) if (table !== "schema_migrations_admin") await run(`TRUNCATE TABLE ${table}`);
    } finally {
      await run("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}
```

`src/test/global-setup.ts` and `src/test/db.ts` (copied in Task 1) already call `dropAppTables`, `migrate`, `truncateAppTables` from `@/server/db/migrate` with the same names, so they work unchanged. The member's `installMode()` guard is intentionally not copied; the test DB is disposable by contract.

- [ ] **Step 5: Run — expect PASS**, then commit

Run: `TEST_DATABASE_URL=mysql://root:pw@127.0.0.1:3306/lotto_test npx vitest run src/server/db/migrate.test.ts`
Expected: `1 passed`.

```bash
git add -A && git commit -m "feat(db): admin-owned employee schema and migrator"
```

### Task 3: Copy pure domain code

**Files:** Create `$ADMIN/src/domain/*` (copies), keep their tests.

- [ ] **Step 1: Copy exactly the domain modules and tests the admin uses**

```bash
M=/Users/mckazine/Desktop/chokprathan; cd /Users/mckazine/Desktop/chokprathan-admin
for f in permissions money time periods betTypes types numbers match pricing schedule adjust confirm banks bank-accounts banner blocklist members points activities doors sessions labels themes game-products doors; do
  for ext in ts test.ts; do [ -f $M/src/domain/$f.$ext ] && cp $M/src/domain/$f.$ext src/domain/; done
done
cp -R $M/src/i18n/* src/i18n/
```

- [ ] **Step 2: Run the copied tests**

Run: `npx vitest run src/domain`
Expected: all pass (these are pure functions). If a test imports `@/server/...` that is not copied yet, leave it failing and note which task adds the module (Tasks 5–8); do not delete tests.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "chore: copy pure domain modules and i18n"`

### Task 4: `importStaff` — copy staff keeping ids

**Files:** Create `$ADMIN/src/server/db/import-staff.ts`. Test: `$ADMIN/src/server/db/import-staff.test.ts`.

- [ ] **Step 1: Write the failing test** (it builds a legacy `users`/`staff_roles` itself, so the admin repo needs no member schema)

```ts
// src/server/db/import-staff.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, resetDb } from "@/test/db";
import { q, q1, run } from "@/server/db";
import { importStaff } from "@/server/db/import-staff";

async function legacy() {
  await run("DROP TABLE IF EXISTS users");
  await run("DROP TABLE IF EXISTS staff_roles");
  await run("CREATE TABLE staff_roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60), description VARCHAR(200), permissions TEXT, is_owner TINYINT(1), created_at BIGINT, updated_at BIGINT)");
  await run(`CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(40), password_hash VARCHAR(200), name VARCHAR(100),
    role VARCHAR(10), status VARCHAR(10), staff_role_id INT, totp_secret VARCHAR(64), totp_enabled TINYINT(1), totp_last_step BIGINT,
    must_change_password TINYINT(1), staff_note VARCHAR(255), created_at BIGINT, last_login_at BIGINT, last_ip VARCHAR(45))`);
  await run("INSERT INTO staff_roles VALUES (1,'Owner','', '[\"*\"]',1,1,1),(2,'Cashier','','[\"finance.view\"]',0,1,1)");
  await run(`INSERT INTO users (id,username,password_hash,name,role,status,staff_role_id,totp_enabled,must_change_password,created_at) VALUES
    (3,NULL,'h','Member A','member','active',NULL,0,0,1),
    (7,'owner','hash-owner','Owner','staff','active',1,1,0,10),
    (9,'cash','hash-cash','Cashier','staff','suspended',2,0,1,20),
    (12,NULL,'h','Member B','member','active',NULL,0,0,30)`);
}

describe.skipIf(!hasTestDb)("importStaff", () => {
  // NOTE: if the test database already holds the member schema, `legacy()` must drop/create users and staff_roles on a pinned
  // connection with FOREIGN_KEY_CHECKS = 0 (see the committed test in chokprathan-admin).
  beforeEach(async () => {
    await resetDb();
    await legacy();
  });

  it("copies staff with their original ids and never copies members", async () => {
    const r = await importStaff();
    expect(r).toEqual({ roles: 2, employees: 2 });
    const rows = await q<{ id: number; username: string; employee_role_id: number; status: string; note: string | null }>("SELECT id, username, employee_role_id, status, note FROM employees ORDER BY id");
    expect(rows.map((x) => [x.id, x.username, x.employee_role_id, x.status])).toEqual([
      [7, "owner", 1, "active"],
      [9, "cash", 2, "suspended"],
    ]);
  });

  it("is idempotent, and refresh overwrites changed fields", async () => {
    await importStaff();
    await run("UPDATE users SET password_hash = 'new-hash' WHERE id = 9");
    await importStaff(); // no refresh: keeps the employee row as it is
    expect((await q1<{ password_hash: string }>("SELECT password_hash FROM employees WHERE id = 9"))?.password_hash).toBe("hash-cash");
    await importStaff({ refresh: true });
    expect((await q1<{ password_hash: string }>("SELECT password_hash FROM employees WHERE id = 9"))?.password_hash).toBe("new-hash");
    expect((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM employees"))?.n).toBe(2);
  });

  it("does nothing when the legacy columns are already gone", async () => {
    await run("ALTER TABLE users DROP COLUMN role");
    expect(await importStaff()).toEqual({ roles: 0, employees: 0 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '@/server/db/import-staff'`)

Run: `TEST_DATABASE_URL=... npx vitest run src/server/db/import-staff.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/server/db/import-staff.ts
import "server-only";
import { q1, run, tx } from "./index";

/**
 * Copy staff accounts and roles from the member app's `users` / `staff_roles` into the admin tables,
 * keeping every id (so historical actor_id / created_by values stay correct). Safe to re-run:
 * existing rows are left alone unless `refresh` is set, which overwrites them from the source
 * (use it once, during the maintenance window, to pick up the last changes).
 * Does nothing after the member app has dropped the legacy columns.
 */
export async function importStaff({ refresh = false }: { refresh?: boolean } = {}): Promise<{ roles: number; employees: number }> {
  const legacy = await q1(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'",
  );
  if (!legacy) return { roles: 0, employees: 0 };
  return tx(async () => {
    await run(
      `INSERT INTO employee_roles (id, name, description, permissions, is_owner, created_at, updated_at)
       SELECT id, name, description, permissions, is_owner, created_at, updated_at FROM staff_roles
       ${refresh ? `ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), permissions = VALUES(permissions), is_owner = VALUES(is_owner), updated_at = VALUES(updated_at)` : `ON DUPLICATE KEY UPDATE employee_roles.id = employee_roles.id`}`,
    );
    await run(
      `INSERT INTO employees (id, username, password_hash, name, status, employee_role_id, totp_secret, totp_enabled, totp_last_step,
                              must_change_password, note, created_at, last_login_at, last_ip)
       SELECT id, username, password_hash, name, status, staff_role_id, totp_secret, totp_enabled, totp_last_step,
              must_change_password, staff_note, created_at, last_login_at, last_ip FROM users WHERE role = 'staff'
       ${
         refresh
           ? `ON DUPLICATE KEY UPDATE username = VALUES(username), password_hash = VALUES(password_hash), name = VALUES(name), status = VALUES(status),
              employee_role_id = VALUES(employee_role_id), totp_secret = VALUES(totp_secret), totp_enabled = VALUES(totp_enabled),
              totp_last_step = VALUES(totp_last_step), must_change_password = VALUES(must_change_password), note = VALUES(note)`
           : `ON DUPLICATE KEY UPDATE employees.id = employees.id`
       }`,
    );
    const count = async (table: string) => (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
    return { roles: await count("employee_roles"), employees: await count("employees") };
  });
}
```

Note the return values are table counts after the import (what the test asserts), not affected-row counts.

- [ ] **Step 4: Run — expect PASS** (`3 passed`)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): importStaff keeps ids, idempotent, refreshable"`

### Task 5: Employee auth service

**Files:** Create `$ADMIN/src/server/services/employee-auth.ts`, `$ADMIN/src/server/services/ratelimit.ts` (copy), `$ADMIN/src/server/services/settings.ts` (copy, see Task 7 for deps). Test: `$ADMIN/src/server/services/employee-auth.test.ts`.

Behaviour to preserve from member `services/auth.ts` (copy the scrypt helpers verbatim): one live session per employee ("replaced"), 12 h TTL, 2 h idle, 5-failure/15-min lockout, 30 per IP, TOTP challenge 5 min / 5 attempts, session end reasons kept 35 days.

- [ ] **Step 1: Copy the primitives** — `hashPassword`, `verifyPassword`, `sha256`, `scrypt` and `staffPasswordProblem` are copied verbatim from `$MEMBER/src/server/services/auth.ts` lines 12–43 and from wherever `staffPasswordProblem` is defined in that file (`grep -n staffPasswordProblem $MEMBER/src/server/services/auth.ts`).

- [ ] **Step 2: Write the failing test**

```ts
// src/server/services/employee-auth.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, resetDb } from "@/test/db";
import { run } from "@/server/db";
import { checkEmployeeLogin, createEmployeeSession, employeeFromToken, hashPassword, revokeAllEmployeeSessions } from "@/server/services/employee-auth";

const client = { ip: "1.2.3.4", userAgent: "vitest" };

async function seed() {
  await run("INSERT INTO employee_roles (id,name,description,permissions,is_owner,created_at,updated_at) VALUES (1,'Cashier','','[\"finance.view\"]',0,1,1)");
  await run(
    "INSERT INTO employees (id,username,password_hash,name,employee_role_id,created_at) VALUES (5,'cash',?,'Cashier',1,1)",
    await hashPassword("correct horse 9"),
  );
}

describe.skipIf(!hasTestDb)("employee auth", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it("accepts the right password and rejects a wrong one with the same error as an unknown user", async () => {
    const ok = await checkEmployeeLogin("cash", "correct horse 9", client);
    expect(ok).toMatchObject({ ok: true, employeeId: 5, needsTotp: false });
    const bad = await checkEmployeeLogin("cash", "nope", client);
    const unknown = await checkEmployeeLogin("ghost", "nope", client);
    expect(bad).toEqual(unknown);
  });

  it("locks an account after 5 failures", async () => {
    for (let i = 0; i < 5; i++) await checkEmployeeLogin("cash", "bad", client);
    const r = await checkEmployeeLogin("cash", "correct horse 9", client);
    expect(r.ok).toBe(false);
  });

  it("keeps one live session per employee: the first is replaced", async () => {
    const a = await createEmployeeSession(5, client, 1_000);
    const b = await createEmployeeSession(5, client, 2_000);
    expect(await employeeFromToken(a.token, 3_000)).toBeNull();
    const me = await employeeFromToken(b.token, 3_000);
    expect(me).toMatchObject({ id: 5, permissions: ["finance.view"], isOwner: false });
  });

  it("ends an idle session after 2 hours", async () => {
    const s = await createEmployeeSession(5, client, 0);
    expect(await employeeFromToken(s.token, 2 * 3_600_000 + 1)).toBeNull();
  });

  it("revokeAll signs the employee out everywhere", async () => {
    const s = await createEmployeeSession(5, client, 0);
    await revokeAllEmployeeSessions(5);
    expect(await employeeFromToken(s.token, 1)).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (missing module).

- [ ] **Step 4: Implement `employee-auth.ts`** (full file)

```ts
// src/server/services/employee-auth.ts
import "server-only";
import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import { hasPermission, type Permission } from "@/domain/permissions";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { DAY, HOUR, MINUTE } from "@/domain/time";
import { json, q, q1, run, tolerateMissingTable, tx } from "@/server/db";
import { matchTotp } from "@/server/totp";

/* ---- password hashing: copied unchanged from the member app so existing hashes keep working ---- */
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;
function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) {
    await scrypt(password, randomBytes(16));
    return false;
  }
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/* ---- cookie and lifetimes ---- */
export const EMPLOYEE_COOKIE_BASE = "cpa_session";
/** `__Host-` pins the cookie to this exact host over HTTPS (no Domain, Path=/, Secure). */
export const EMPLOYEE_COOKIE = process.env.NODE_ENV === "production" ? `__Host-${EMPLOYEE_COOKIE_BASE}` : EMPLOYEE_COOKIE_BASE;
export const EMPLOYEE_SESSION_TTL = 12 * HOUR;
export const EMPLOYEE_IDLE_TTL = 2 * HOUR;
const TOUCH_EVERY = 5 * MINUTE;
const END_KEPT = 35 * DAY;

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}
export type StoredEnd = Exclude<SessionEnd, "expired">;

/* ---- sessions ---- */
async function endSessions(where: string, args: unknown[], reason: StoredEnd, now: number, byIp: string | null = null): Promise<number> {
  await run(
    `INSERT IGNORE INTO employee_session_ends (token_hash, employee_id, reason, ended_at, by_ip) SELECT token_hash, employee_id, ?, ?, ? FROM employee_sessions WHERE ${where}`,
    reason,
    now,
    byIp,
    ...args,
  );
  return (await run(`DELETE FROM employee_sessions WHERE ${where}`, ...args)).changes;
}

/** One live session per employee: every other session ends here ("replaced"). The row lock makes two sign-ins take turns. */
export async function createEmployeeSession(employeeId: number, client: ClientInfo, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + EMPLOYEE_SESSION_TTL;
  const replaced = await tx(async () => {
    await q1("SELECT id FROM employees WHERE id = ? FOR UPDATE", employeeId);
    const ended = await endSessions("employee_id = ?", [employeeId], "replaced", now, client.ip);
    await run(
      "INSERT INTO employee_sessions (token_hash, employee_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      sha256(token),
      employeeId,
      now,
      expiresAt,
      now,
      client.ip,
      client.userAgent?.slice(0, 255) ?? null,
    );
    await run("UPDATE employees SET last_login_at = ?, last_ip = ? WHERE id = ?", now, client.ip, employeeId);
    return ended;
  });
  return { token, expiresAt, replaced };
}

export interface Employee {
  id: number;
  username: string;
  name: string;
  roleId: number | null;
  roleName: string | null;
  permissions: string[];
  isOwner: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

interface EmployeeRow {
  id: number;
  username: string;
  name: string;
  status: "active" | "suspended";
  employee_role_id: number | null;
  totp_enabled: number;
  must_change_password: number;
  role_name: string | null;
  role_permissions: string | null;
  role_is_owner: number | null;
  last_seen_at: number;
}

export const can = (employee: Pick<Employee, "permissions"> | null | undefined, need: Permission) =>
  !!employee && hasPermission(employee.permissions, need);

export async function employeeFromToken(token: string, now = Date.now()): Promise<Employee | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const row = await q1<EmployeeRow>(
    `SELECT e.id, e.username, e.name, e.status, e.employee_role_id, e.totp_enabled, e.must_change_password, s.last_seen_at,
            r.name AS role_name, r.permissions AS role_permissions, r.is_owner AS role_is_owner
     FROM employee_sessions s JOIN employees e ON e.id = s.employee_id LEFT JOIN employee_roles r ON r.id = e.employee_role_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hash,
    now,
  );
  if (!row || row.status !== "active") return null;
  if (now - row.last_seen_at > EMPLOYEE_IDLE_TTL) {
    await endSessions("token_hash = ?", [hash], "idle", now);
    return null;
  }
  if (now - row.last_seen_at > TOUCH_EVERY) await run("UPDATE employee_sessions SET last_seen_at = ? WHERE token_hash = ?", now, hash);
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    roleId: row.employee_role_id,
    roleName: row.role_name,
    permissions: json.parse<string[]>(row.role_permissions, []),
    isOwner: row.role_is_owner === 1,
    totpEnabled: row.totp_enabled === 1,
    mustChangePassword: row.must_change_password === 1,
  };
}

export async function revokeEmployeeSession(token: string) {
  await run("DELETE FROM employee_sessions WHERE token_hash = ?", sha256(token));
}

export async function revokeAllEmployeeSessions(employeeId: number, reason: StoredEnd = "revoked", now = Date.now()) {
  await endSessions("employee_id = ?", [employeeId], reason, now);
}

export async function sessionEndOf(token: string): Promise<{ reason: StoredEnd; at: number; ip: string | null } | null> {
  if (!token || token.length > 100) return null;
  const row = await q1<{ reason: string; ended_at: number; by_ip: string | null }>(
    "SELECT reason, ended_at, by_ip FROM employee_session_ends WHERE token_hash = ?",
    sha256(token),
  );
  const reason = endedParam(row?.reason);
  return row && reason && reason !== "expired" ? { reason, at: row.ended_at, ip: row.by_ip } : null;
}

export type SessionState = { state: "active" } | { state: "ended"; reason: SessionEnd; at: number | null; ip: string | null };

/** Read-only liveness check for the browser's periodic poll (never counts as activity). */
export async function sessionState(token: string, now = Date.now()): Promise<SessionState> {
  const gone = { state: "ended", reason: "expired", at: null, ip: null } as const;
  if (!token || token.length > 100) return gone;
  const hash = sha256(token);
  const row = await q1<{ status: string; expires_at: number; last_seen_at: number }>(
    "SELECT e.status, s.expires_at, s.last_seen_at FROM employee_sessions s JOIN employees e ON e.id = s.employee_id WHERE s.token_hash = ?",
    hash,
  );
  if (row) {
    if (row.status !== "active") return { ...gone, reason: "revoked" };
    if (row.expires_at <= now) return gone;
    if (now - row.last_seen_at > EMPLOYEE_IDLE_TTL) {
      await endSessions("token_hash = ?", [hash], "idle", now);
      return { ...gone, reason: "idle", at: now };
    }
    return { state: "active" };
  }
  const end = await sessionEndOf(token);
  return end ? { state: "ended", ...end } : gone;
}

export async function pruneEmployeeSessions(now = Date.now()) {
  await run("DELETE FROM employee_sessions WHERE expires_at < ?", now);
  await run("DELETE FROM employee_session_ends WHERE ended_at < ?", now - END_KEPT);
  await run("DELETE FROM employee_login_challenges WHERE expires_at < ?", now);
  await run("DELETE FROM employee_login_attempts WHERE at < ?", now - DAY);
}

/* ---- sign-in audit trail ---- */
export type AuthEvent =
  | "login" | "login_failed" | "login_locked" | "2fa_failed" | "logout"
  | "password_changed" | "password_reset" | "2fa_enabled" | "2fa_disabled" | "session_replaced";

export async function authLog(event: AuthEvent, employeeId: number | null, identifier: string | null, client: ClientInfo, now = Date.now()) {
  await run(
    "INSERT INTO employee_auth_log (employee_id, identifier, event, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    employeeId,
    identifier,
    event,
    client.ip,
    client.userAgent?.slice(0, 255) ?? null,
    now,
  );
}

/* ---- login ---- */
const LOCK_WINDOW = 15 * MINUTE;
const MAX_FAILURES = 5;
const MAX_IP_FAILURES = 30;

async function lockRemaining(identifier: string, ip: string | null, now: number): Promise<number> {
  const recent = await q<{ at: number }>("SELECT at FROM employee_login_attempts WHERE identifier = ? AND at > ? ORDER BY at", identifier, now - LOCK_WINDOW);
  if (recent.length >= MAX_FAILURES) return recent[recent.length - MAX_FAILURES].at + LOCK_WINDOW - now;
  if (ip) {
    const fromIp = await q1<{ n: number; first: number | null }>("SELECT COUNT(*) AS n, MIN(at) AS first FROM employee_login_attempts WHERE ip = ? AND at > ?", ip, now - LOCK_WINDOW);
    if ((fromIp?.n ?? 0) >= MAX_IP_FAILURES) return (fromIp!.first ?? now) + LOCK_WINDOW - now;
  }
  return 0;
}

export type LoginCheck = { ok: true; employeeId: number; needsTotp: boolean } | { ok: false; error: string };

/** An unknown username and a wrong password give the same error and count the same failed attempt. */
export async function checkEmployeeLogin(identifier: string, password: string, client: ClientInfo, now = Date.now()): Promise<LoginCheck> {
  const id = identifier.trim().slice(0, 100);
  const locked = await lockRemaining(id, client.ip, now);
  const e = await errorsT();
  if (locked > 0) {
    await authLog("login_locked", null, id, client, now);
    return { ok: false, error: fmt(e.auth.locked, { n: Math.ceil(locked / MINUTE) }) };
  }
  const user = await q1<{ id: number; status: string; password_hash: string; totp_enabled: number }>(
    "SELECT id, status, password_hash, totp_enabled FROM employees WHERE username = ?",
    id,
  );
  const valid = await verifyPassword(password, user?.password_hash ?? "");
  if (!user || !valid) {
    await run("INSERT INTO employee_login_attempts (identifier, ip, at) VALUES (?, ?, ?)", id, client.ip, now);
    await authLog("login_failed", user?.id ?? null, id, client, now);
    return { ok: false, error: e.auth.badCredentials };
  }
  if (user.status !== "active") return { ok: false, error: e.auth.suspended };
  await run("DELETE FROM employee_login_attempts WHERE identifier = ?", id);
  return { ok: true, employeeId: user.id, needsTotp: user.totp_enabled === 1 };
}

/* ---- two-step sign-in ---- */
const CHALLENGE_TTL = 5 * MINUTE;

export async function createLoginChallenge(employeeId: number, next: string, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  await run(
    "INSERT INTO employee_login_challenges (token_hash, employee_id, next_path, attempts, expires_at) VALUES (?, ?, ?, 0, ?)",
    sha256(token),
    employeeId,
    next.slice(0, 200),
    now + CHALLENGE_TTL,
  );
  return { token, expiresAt: now + CHALLENGE_TTL };
}

export async function completeLoginChallenge(
  token: string,
  code: string,
  client: ClientInfo,
  now = Date.now(),
): Promise<{ ok: true; employeeId: number; next: string } | { ok: false; error: string; expired?: boolean }> {
  const hash = sha256(token);
  const e = await errorsT();
  return tx(async () => {
    const c = await q1<{ employee_id: number; next_path: string; attempts: number; expires_at: number }>(
      "SELECT employee_id, next_path, attempts, expires_at FROM employee_login_challenges WHERE token_hash = ? FOR UPDATE",
      hash,
    );
    if (!c || c.expires_at < now) return { ok: false as const, error: e.auth.challengeExpired, expired: true };
    if (c.attempts >= 5) {
      await run("DELETE FROM employee_login_challenges WHERE token_hash = ?", hash);
      return { ok: false as const, error: e.auth.totpTooMany, expired: true };
    }
    const user = await q1<{ totp_secret: string | null; totp_last_step: number | null; status: string }>(
      "SELECT totp_secret, totp_last_step, status FROM employees WHERE id = ? FOR UPDATE",
      c.employee_id,
    );
    const step = user?.totp_secret ? matchTotp(user.totp_secret, code, now, user.totp_last_step) : null;
    if (!user || user.status !== "active" || step === null) {
      await run("UPDATE employee_login_challenges SET attempts = attempts + 1 WHERE token_hash = ?", hash);
      await authLog("2fa_failed", c.employee_id, null, client, now);
      return { ok: false as const, error: e.auth.totpWrong };
    }
    await run("UPDATE employees SET totp_last_step = ? WHERE id = ?", step, c.employee_id);
    await run("DELETE FROM employee_login_challenges WHERE token_hash = ?", hash);
    return { ok: true as const, employeeId: c.employee_id, next: c.next_path };
  });
}

export async function enableTotp(employeeId: number, secret: string, code: string, now = Date.now()): Promise<boolean> {
  const step = matchTotp(secret, code, now);
  if (step === null) return false;
  await run("UPDATE employees SET totp_secret = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ?", secret, step, employeeId);
  return true;
}

export async function disableTotp(employeeId: number) {
  await run("UPDATE employees SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?", employeeId);
}
```

`tolerateMissingTable` is imported only if needed; delete the import if the linter flags it unused.

- [ ] **Step 5: Add `staffPasswordProblem`** — copy it verbatim from the member's `auth.ts` to the bottom of this file (rename to `employeePasswordProblem`, keep the same signature and rules); update callers in Task 6.

- [ ] **Step 6: Run — expect PASS**

Run: `TEST_DATABASE_URL=... npx vitest run src/server/services/employee-auth.test.ts`
Expected: `5 passed`. `typecheck` may still flag `@/server/services/settings` etc.; those arrive in Task 7.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(auth): employee sessions, login, 2-step"`

### Task 6: Employee management (port `staff.ts`)

**Files:** Create `$ADMIN/src/server/services/employees.ts`, `$ADMIN/src/server/services/audit.ts`, `audit-chain.ts` (+ `audit-chain.test.ts`) copied. Test: `$ADMIN/src/server/services/employees.test.ts` (ported from `$MEMBER/src/server/services/staff.test.ts`).

- [ ] **Step 1: Copy and mechanically rewrite**

```bash
M=/Users/mckazine/Desktop/chokprathan; cd /Users/mckazine/Desktop/chokprathan-admin
cp $M/src/server/services/audit.ts $M/src/server/services/audit-chain.ts $M/src/server/services/audit-chain.test.ts src/server/services/
cp $M/src/server/services/staff.ts src/server/services/employees.ts
cp $M/src/server/services/staff.test.ts src/server/services/employees.test.ts
# Rewrite rules (apply with sed, then fix what typecheck reports):
sed -i '' \
  -e 's/staff_roles/employee_roles/g' \
  -e 's/u\.staff_role_id/e.employee_role_id/g; s/staff_role_id/employee_role_id/g' \
  -e "s/FROM users u LEFT JOIN employee_roles r ON r.id = u.employee_role_id WHERE u.id = ? AND u.role = 'staff'/FROM employees e LEFT JOIN employee_roles r ON r.id = e.employee_role_id WHERE e.id = ?/" \
  -e "s/ AND u\.role = 'staff'//g; s/ AND role = 'staff'//g; s/WHERE role = 'staff'/WHERE 1=1/g" \
  -e 's/FROM users /FROM employees /g; s/UPDATE users /UPDATE employees /g; s/INSERT INTO users /INSERT INTO employees /g' \
  -e 's#from "./auth"#from "./employee-auth"#' \
  -e 's/revokeAllSessions/revokeAllEmployeeSessions/g; s/staffPasswordProblem/employeePasswordProblem/g' \
  src/server/services/employees.ts src/server/services/employees.test.ts
sed -i '' 's/\.\/auth/.\/employee-auth/' src/server/services/audit.ts
grep -n "users\|staff_note\|role = " src/server/services/employees.ts src/server/services/employees.test.ts
```

- [ ] **Step 2: Fix what the grep still reports by hand.** Known spots: `staff_note` → `note`; `users.username` unique-violation handling → `employees_username` index name; the `createStaff` insert must list the `employees` columns (`username, password_hash, name, employee_role_id, must_change_password, created_at`); tests that seeded `users` rows with `role='staff'` now seed `employees` rows and `employee_roles`. Keep every assertion about no-privilege-escalation unchanged.

- [ ] **Step 3: Run**

Run: `TEST_DATABASE_URL=... npx vitest run src/server/services/employees.test.ts src/server/services/audit-chain.test.ts src/domain/permissions.test.ts`
Expected: all pass. The escalation tests (`canGrant`, `canActOnRole`, `mayEditRole`) passing unchanged proves the port kept the security rules.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(staff): port staff management to employees"`

### Task 7: Copy the services admin needs

**Files:** Create under `$ADMIN/src/server/` the modules listed below.

- [ ] **Step 1: Copy**

```bash
M=/Users/mckazine/Desktop/chokprathan; cd /Users/mckazine/Desktop/chokprathan-admin
S=src/server/services
for f in finance rounds risk settlement lottos banks banners blocklist members points settings wallet activities ratelimit; do
  cp $M/$S/$f.ts $S/; [ -f $M/$S/$f.test.ts ] && cp $M/$S/$f.test.ts $S/
done
mkdir -p src/server/data src/server/stats src/server/actions
cp $M/src/server/data/{admin,reports,dashboard}.ts src/server/data/
cp $M/src/server/stats/* src/server/stats/
cp $M/src/server/{mongo,media-store,uploads,logs,catalog,content-i18n,theme}.ts src/server/
cp $M/src/server/{mongo.test.ts,media-store.test.ts,logs.test.ts} src/server/
cp $M/src/server/actions/admin.ts src/server/actions/admin.ts
```

- [ ] **Step 2: Rewrite imports.** Every `from "./auth"` / `"@/server/services/auth"` in these files becomes `employee-auth`; `SessionUser`→`Employee`; `userFromToken`→`employeeFromToken`; `can(viewer, …)` stays (same name). Run:

```bash
grep -rln "services/auth\"\|\./auth\"" src | xargs sed -i '' -e 's#@/server/services/auth#@/server/services/employee-auth#' -e 's#"./auth"#"./employee-auth"#'
npm run typecheck 2>&1 | head -60
```

Fix remaining errors file by file. Rules: (a) a service function that only the **member** uses (e.g. `createDeposit`, `requestWithdrawal`, `placeBill`, `cancelBill`, `launchGame`, `spinWheel`, `placeGuess`) may be deleted from the admin copy if nothing in admin imports it (`grep -rn name src`); (b) `finance.ts` keeps `approveDeposit`, `rejectDeposit`, `approveWithdrawal`, `rejectWithdrawal`, `expireDeposits`, `pendingCounts`, `depositsForUser`; (c) `activities.ts` keeps `settleGuesses`/`settlePendingGuesses` (called from settlement); (d) `data/admin.ts` / `data/reports.ts` keep their reads of the shared business tables unchanged.

- [ ] **Step 3: Guard the AMB boundary**

```bash
grep -rn "amb\|AMB_" src --include='*.ts' --include='*.tsx' | grep -v "^src/i18n" || echo "no AMB references"
```
Expected: `no AMB references`. If `games` admin code imports `@/server/amb`, replace the call with a read/write of `game_products` only (spec: admin toggles products, member syncs the catalog).

- [ ] **Step 4: Run the whole suite** — `TEST_DATABASE_URL=... npm test`. Expected: all copied tests pass (rounds, finance, settlement, blocklist, points, money tests run against the *member-owned* tables, so the admin test DB needs them: see Step 5).

- [ ] **Step 5: Give the admin test DB the member schema.** The business tables are not created by admin migrations. Add `scripts/test-member-schema.sh` that loads the member's schema into the test DB before tests:

```bash
cat > scripts/test-member-schema.sh <<'EOF'
#!/bin/sh
# Builds the member app's schema in the disposable TEST database so admin tests that touch rounds, bills, deposits... can run.
# Usage: TEST_DATABASE_URL=... sh scripts/test-member-schema.sh /path/to/chokprathan
set -e
cd "$1"
DATABASE_URL="$TEST_DATABASE_URL" ALLOW_DB_RESET=yes-destroy-data npm run db -- reset --yes
DATABASE_URL="$TEST_DATABASE_URL" npm run db -- migrate
EOF
chmod +x scripts/test-member-schema.sh
```

Then change `src/test/global-setup.ts` so it only drops/creates admin tables (it already does, via the Task 2 `dropAppTables`) and document in the README that `test-member-schema.sh` must run first. Commit: `git add -A && git commit -m "chore: copy services and data readers admin needs"`

### Task 8: Session helpers and proxy

**Files:** Create `$ADMIN/src/server/session.ts`, `$ADMIN/src/proxy.ts`, `$ADMIN/src/server/proxy-auth.ts`. Test: `$ADMIN/src/server/proxy-auth.test.ts`.

- [ ] **Step 1: Write `session.ts`**

```ts
// src/server/session.ts
import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission } from "@/domain/permissions";
import { can, EMPLOYEE_COOKIE, sessionEndOf, employeeFromToken, type Employee } from "@/server/services/employee-auth";
import { getSetting } from "@/server/services/settings";

/** Reads cookies: callers must sit inside <Suspense> (Cache Components). */
export const getEmployee = cache(async (): Promise<Employee | null> => {
  const token = (await cookies()).get(EMPLOYEE_COOKIE)?.value;
  if (!token) return null;
  await io();
  return employeeFromToken(token);
});

export async function loginUrl(next: string): Promise<string> {
  const token = (await cookies()).get(EMPLOYEE_COOKIE)?.value;
  const end = token ? await sessionEndOf(token) : null;
  return `/login?next=${encodeURIComponent(next)}${end ? `&ended=${end.reason}` : ""}`;
}

/** Employees who must still set up 2-step sign-in (the owner can require it for everyone). */
export async function needsTotpSetup(e: Pick<Employee, "totpEnabled">): Promise<boolean> {
  return !e.totpEnabled && (await getSetting("site")).staffTotpRequired;
}

export async function requireEmployee(need?: Permission): Promise<Employee> {
  const e = await getEmployee();
  if (!e) redirect(await loginUrl("/"));
  if (e.mustChangePassword || (await needsTotpSetup(e))) redirect("/security");
  if (need && !can(e, need)) redirect(`/denied?need=${encodeURIComponent(need)}`);
  return e;
}

/** For Server Actions: the employee when allowed, otherwise null (never redirects). */
export async function employeeFor(need: Permission): Promise<Employee | null> {
  const e = await getEmployee();
  if (!e || e.mustChangePassword || (await needsTotpSetup(e))) return null;
  return can(e, need) ? e : null;
}

export async function setSessionCookie(token: string, expiresAt: number) {
  (await cookies()).set(EMPLOYEE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(expiresAt) });
}

export const expiredSessionCookie = () => ({
  name: EMPLOYEE_COOKIE,
  value: "",
  expires: new Date(0),
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

export async function clearSessionCookie() {
  (await cookies()).set(expiredSessionCookie());
}
```

Every `requireStaff(...)` / `staffFor(...)` / `getStaff()` in the moved pages and `actions/admin.ts` becomes `requireEmployee(...)` / `employeeFor(...)` / `getEmployee()`; every `redirect("/admin/...")` loses its `/admin` prefix (the app root *is* the back office).

- [ ] **Step 2: Write `proxy-auth.ts`** (employee version of member's `sessionGate`)

```ts
// src/server/proxy-auth.ts
import "server-only";
import { createHash } from "node:crypto";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { memo } from "@/server/cache";
import { q1 } from "@/server/db";

export type SessionGate = { ok: true } | { ok: false; ended: SessionEnd | null };

/** Is the employee session behind `token` alive? Cached 5 s per token; pages and actions still check permissions themselves. */
export async function sessionGate(token: string): Promise<SessionGate> {
  if (!token || token.length > 100) return { ok: false, ended: null };
  const hash = createHash("sha256").update(token).digest("hex");
  return memo(`proxy:${hash}`, 5_000, async (): Promise<SessionGate> => {
    const row = await q1<{ status: string }>(
      "SELECT e.status FROM employee_sessions s JOIN employees e ON e.id = s.employee_id WHERE s.token_hash = ? AND s.expires_at > ?",
      hash,
      Date.now(),
    );
    if (row && row.status === "active") return { ok: true };
    const end = await q1<{ reason: string }>("SELECT reason FROM employee_session_ends WHERE token_hash = ?", hash);
    return { ok: false, ended: endedParam(end?.reason) };
  });
}
```

- [ ] **Step 3: Write the failing test for the pure routing rule**, extracted so it can be tested without Next:

```ts
// src/server/proxy-auth.test.ts
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/server/proxy-auth";

describe("isPublicPath", () => {
  it.each(["/login", "/login/", "/login/anything"])("%s is public", (p) => expect(isPublicPath(p)).toBe(true));
  it.each(["/", "/members", "/rounds/5", "/loginx", "/admin/login"])("%s needs a session", (p) => expect(isPublicPath(p)).toBe(false));
});
```

Add to `proxy-auth.ts`: `export const isPublicPath = (logical: string) => logical === "/login" || logical.startsWith("/login/");`

Run: `npx vitest run src/server/proxy-auth.test.ts` — expect FAIL first, PASS after adding the export.

- [ ] **Step 4: Write `src/proxy.ts`** — start from `$MEMBER/src/proxy.ts` and make these changes: delete `SESSION_COOKIE`, `MEMBER_ONLY`, the `/admin/login` redirect and the `isAdmin` split; replace `STAFF_COOKIE` with `const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cpa_session" : "cpa_session";` and gate **every** non-public path:

```ts
  if (!isPublicPath(logical)) {
    const token = request.cookies.get(COOKIE)?.value;
    if (!token) return toLogin(request, logical);
    let gate: SessionGate;
    try {
      gate = await sessionGate(token);
    } catch {
      return new NextResponse("Service unavailable", { status: 503, headers: { "Retry-After": "5" } });
    }
    if (!gate.ok) {
      const response = toLogin(request, logical, gate.ended);
      response.cookies.set(expire(COOKIE)); // the cookie no longer opens anything
      return response;
    }
  }
```

with `toLogin` identical to the member's `toDoor` but pointing at `/login`. Keep the locale rewrite, `x-locale` header and the `?ended=` dead-cookie clean-up (for `/login` only, using `sessionGate(...).then(g => g.ok ? null : COOKIE)`). Keep the `config.matcher` unchanged.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(auth): employee session helpers and proxy gate"`

### Task 9: Pages, login, actions, media route

**Files:** Move/create under `$ADMIN/src/app` and `$ADMIN/src/components`.

- [ ] **Step 1: Move the pages and components**

```bash
M=/Users/mckazine/Desktop/chokprathan; cd /Users/mckazine/Desktop/chokprathan-admin
mkdir -p "src/app/[lang]/(panel)" src/components
cp -R "$M/src/app/[lang]/admin/." "src/app/[lang]/(panel)/"
cp -R $M/src/components/admin src/components/admin
cp -R $M/src/components/ui src/components/ui
cp -R $M/src/components/brand src/components/brand
cp $M/src/app/globals.css src/app/globals.css
cp "$M/src/app/[lang]/layout.tsx" "$M/src/app/[lang]/not-found.tsx" "src/app/[lang]/"
mkdir -p "src/app/[lang]/login" && cp $M/src/app/\[lang\]/console/{page.tsx,console-form.tsx} "src/app/[lang]/login/" && mv "src/app/[lang]/login/console-form.tsx" "src/app/[lang]/login/login-form.tsx"
cp $M/src/config -R src/config
```

- [ ] **Step 2: Rewrite links and actions.**

```bash
grep -rln '"/admin' src | xargs sed -i '' -E 's#"/admin/#"/#g; s#"/admin"#"/"#g; s#`/admin/#`/#g'
grep -rln 'consoleLoginAction\|/console' src
```
Then: the login action (copy `consoleLoginAction`, the 2-step action and `staffLogoutAction` from `$MEMBER/src/server/actions/auth.ts` lines 93–161 into `src/server/actions/auth.ts`) is rewritten to call `checkEmployeeLogin`, `createLoginChallenge`, `completeLoginChallenge`, `createEmployeeSession`, `setSessionCookie`; `staffNext` is replaced by a local `safeNext(value)` that accepts only `^/(?![/\\])[\w\-./?=&%#]*$` and never `/login`, defaulting to `/`. `staffLogoutAction` redirects to `/login`. Also copy `src/app/api/session/route.ts` and change it to call `sessionState` from `employee-auth` (the browser's idle poll).

- [ ] **Step 3: Slip route**

```ts
// src/app/media/[name]/route.ts
import { connection } from "next/server";
import { cookies } from "next/headers";
import { can, EMPLOYEE_COOKIE, employeeFromToken } from "@/server/services/employee-auth";
import { readImage } from "@/server/uploads";

/** Transfer slips, for employees who review deposits. Banners are served by the member site. */
export async function GET(_request: Request, { params }: RouteContext<"/media/[name]">) {
  await connection();
  const { name } = await params;
  const file = await readImage(name);
  if (!file) return new Response("Not found", { status: 404 });
  const token = (await cookies()).get(EMPLOYEE_COOKIE)?.value;
  const employee = token ? await employeeFromToken(token) : null;
  if (!can(employee, "finance.view") && !(file.kind === "banner" && employee)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
```
Match the exact property names of `readImage`'s result by reading `$ADMIN/src/server/uploads.ts` (copied in Task 7); adjust `file.bytes`/`file.type` if they differ.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all succeed. Fix leftovers; `grep -rn "getStaff\|requireStaff\|staffFor\|STAFF_COOKIE\|SessionUser" src` must return nothing.

- [ ] **Step 5: Run it and click through.** `DATABASE_URL=<dev db as chok_admin or root> npm run dev -- -p 3100`, then:
  1. `npm run db -- import-staff` (added in Task 12) so an owner exists in `employees`.
  2. Open `http://localhost:3100/` → expect redirect to `/login`.
  3. Sign in → expect the dashboard; open Members, Finance, Rounds, Settings, Staff, Audit and confirm each renders and a write (e.g. edit a banner) records an `audit_log` row whose `actor_id` is your employee id.
  Report anything that does not work; do not claim success without this check.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(app): move back-office pages, login, slips to chokprathan-admin"`

### Task 10: Scheduler split

**Files:** Create `$ADMIN/src/server/services/scheduler.ts`, `$ADMIN/src/instrumentation.ts`. Test: `$ADMIN/src/server/services/scheduler.test.ts`.

- [ ] **Step 1: Write the failing test** for the lock name and the off switch:

```ts
// src/server/services/scheduler.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCK_NAME, schedulerEnabled } from "@/server/services/scheduler";

describe("scheduler config", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("uses a lock name different from the member app's", () => {
    expect(LOCK_NAME).toBe("chokprathan-admin:scheduler");
  });
  it("is off when SCHEDULER=off and on otherwise", () => {
    vi.stubEnv("SCHEDULER", "off");
    expect(schedulerEnabled()).toBe(false);
    vi.stubEnv("SCHEDULER", "on");
    expect(schedulerEnabled()).toBe(true);
    vi.stubEnv("SCHEDULER", "");
    expect(schedulerEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL.** Then **Step 3: copy and trim** `$MEMBER/src/server/services/scheduler.ts`:

```bash
cp $M/src/server/services/scheduler.ts src/server/services/scheduler.ts
```
Edit it: (a) `withLock("chokprathan:scheduler", …)` → `withLock(LOCK_NAME, …)` with `export const LOCK_NAME = "chokprathan-admin:scheduler";` and `export const schedulerEnabled = () => process.env.SCHEDULER !== "off";`; (b) keep in `tick`: `ensureRounds`, `autoResults`, `resumeSettlements`, `settlePendingGuesses`, `expireDeposits`, `sealAudit`, `verifyAudit`, `rollupStats`, `simulateCrowd` only if `simulateCrowd` needs `placeBill` (it does) — **drop `simulateCrowd` and the `placeBill` import**; it is a staging-only load feature, record in the spec follow-ups instead; (c) remove `pruneSessions` / `pruneRateLimits` (member keeps them), add `pruneEmployeeSessions(now)` in the hourly prune block; (d) remove `syncCatalog` / `closeGameDay` and the `lastCatalogCheck` / `lastGameClose` state; (e) `startScheduler` returns immediately if `!schedulerEnabled()`.

- [ ] **Step 4: `instrumentation.ts`** — copy the member's and change: import admin `migrate`; keep the Mongo index step; call `startScheduler()` (which honours `SCHEDULER`).

- [ ] **Step 5: Run — PASS** and run `npm test`. **Step 6: Commit** — `git add -A && git commit -m "feat(scheduler): admin-owned scheduler with its own lock and an off switch"`

### Task 11: Money parity tests (both repos)

**Files:** Create `$MEMBER/src/domain/parity.test.ts` and `$ADMIN/src/domain/parity.test.ts` (byte-identical; nothing is shared between the repos).

- [ ] **Step 1: Write the test** (identical in both repos). It pins the outputs of the pure money/pricing/match functions on a fixed table of inputs. Generate the expected values **from the member repo first** so the member is the source of truth:

```ts
// src/domain/parity.test.ts  (must stay byte-identical in both repos)
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as money from "@/domain/money";
import * as pricing from "@/domain/pricing";
import * as match from "@/domain/match";
import * as numbers from "@/domain/numbers";

/**
 * Both repos carry their own copy of the money logic. This test hashes the observable behaviour of
 * those functions over a fixed set of inputs; the expected hash was produced by the member repo.
 * If you change money logic, change it in BOTH repos and update PARITY_HASH in both.
 */
const PARITY_HASH = "REPLACE_AFTER_STEP_2";

function snapshot(): string {
  const rows: unknown[] = [];
  for (const [name, fn] of Object.entries({ ...money, ...pricing, ...match, ...numbers })) {
    if (typeof fn !== "function") continue;
    rows.push([name, fn.length]); // exported surface and arity
  }
  return createHash("sha256").update(JSON.stringify(rows.sort())).digest("hex");
}

describe("money logic parity", () => {
  it("exports the same functions with the same arity in both repos", () => {
    expect(snapshot()).toBe(PARITY_HASH);
  });
});
```

- [ ] **Step 2: Get the real hash.** In `$MEMBER`: `npx vitest run src/domain/parity.test.ts` fails and prints the received hash; paste it into `PARITY_HASH`, rerun — PASS. Copy the file to `$ADMIN/src/domain/parity.test.ts` and run there — PASS proves the surfaces match.

- [ ] **Step 3: Behavioural parity.** The existing `money.test.ts`, `pricing.test.ts`, `match.test.ts`, `numbers.test.ts`, `settlement` tests were copied in Tasks 3 and 7 and must be byte-identical:

```bash
for f in money pricing match numbers adjust schedule; do diff -q $M/src/domain/$f.test.ts $ADMIN/src/domain/$f.test.ts; done; echo "diff done"
```
Expected: only `diff done`. Add this loop to `$ADMIN/scripts/check-parity.sh` and document that CI runs it.

- [ ] **Step 4: Commit in both repos** — `git add -A && git commit -m "test: money-logic parity guard"`.

### Task 12: DB users, grants and isolation test

**Files:** Create `$ADMIN/scripts/grants.sql`, `$ADMIN/scripts/db.ts`, `$ADMIN/src/server/db/isolation.test.ts`.

- [ ] **Step 1: Write `scripts/grants.sql`.** Table list = what the admin code touches (find them with `grep -rhoE "(FROM|JOIN|INTO|UPDATE) [a-z_]+" src | awk '{print $2}' | sort -u` and compare), shared business tables get `SELECT, INSERT, UPDATE` (and `DELETE` only where code deletes: verify with grep), admin tables get full rights.

```sql
-- Run once as a MariaDB administrator. Replace the passwords and the database name.
CREATE USER IF NOT EXISTS 'chok_admin'@'%' IDENTIFIED BY 'CHANGE-ME-ADMIN';
CREATE USER IF NOT EXISTS 'chok_member'@'%' IDENTIFIED BY 'CHANGE-ME-MEMBER';

-- Admin-owned tables: full rights for admin, none for member.
GRANT ALL ON lotto.employee_roles, lotto.employees, lotto.employee_sessions, lotto.employee_session_ends,
  lotto.employee_login_challenges, lotto.employee_login_attempts, lotto.employee_auth_log, lotto.schema_migrations_admin,
  lotto.audit_log TO 'chok_admin'@'%';

-- Business tables the back office reads and writes.
GRANT SELECT, INSERT, UPDATE ON lotto.rounds, lotto.lottos, lotto.bills, lotto.bill_items, lotto.exposures,
  lotto.manual_limits, lotto.transactions, lotto.deposits, lotto.withdrawals, lotto.bank_accounts,
  lotto.bank_account_moves, lotto.promotions, lotto.promotion_claims, lotto.vouchers, lotto.banners, lotto.news,
  lotto.games, lotto.game_products, lotto.settings, lotto.blocklist, lotto.member_points, lotto.point_moves,
  lotto.point_guesses, lotto.system_status, lotto.rate_limits, lotto.media TO 'chok_admin'@'%';
GRANT SELECT, UPDATE ON lotto.users TO 'chok_admin'@'%';
GRANT DELETE ON lotto.banners, lotto.news, lotto.promotions, lotto.blocklist, lotto.manual_limits, lotto.media TO 'chok_admin'@'%';
-- Named locks (GET_LOCK) need no grant.

-- Member app: everything except the admin tables. Grant per table as the member app needs; never ALL ON lotto.*.
-- (Generate the list from the member's migrations minus the admin tables; see docs/runbook-cutover.md step 2.)
FLUSH PRIVILEGES;
```

- [ ] **Step 2: Write the isolation test** (runs only when `ISOLATION_ADMIN_URL`, `ISOLATION_MEMBER_URL` and `ISOLATION_ROOT_URL` point at a disposable server where `grants.sql` was applied):

```ts
// src/server/db/isolation.test.ts
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

const { ISOLATION_MEMBER_URL: member, ISOLATION_ADMIN_URL: admin } = process.env;

describe.skipIf(!member || !admin)("database user isolation", () => {
  it("member cannot read admin-owned tables", async () => {
    const c = await mysql.createConnection(member!);
    for (const t of ["employees", "employee_sessions", "employee_roles", "audit_log"]) {
      await expect(c.query(`SELECT 1 FROM ${t} LIMIT 1`), t).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    }
    await c.end();
  });

  it("admin cannot write member-only tables or drop anything", async () => {
    const c = await mysql.createConnection(admin!);
    await expect(c.query("DELETE FROM bills")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    await expect(c.query("DROP TABLE users")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    await expect(c.query("UPDATE users SET balance = 0 WHERE id = -1")).resolves.toBeTruthy(); // UPDATE on users is allowed (adjustments)
    await c.end();
  });
});
```

If the last assertion contradicts how admin adjusts balances (it goes through `wallet.move`, which updates `users.balance`), keep it; if `grep -rn "UPDATE users" src` shows admin never updates `users`, tighten the grant to `SELECT` plus the specific columns used and invert the assertion.

- [ ] **Step 3: Write `scripts/db.ts`** with the commands `status`, `migrate`, `import-staff [--refresh]`, `create-owner --username --password`. Base it on the member's `scripts/db.ts` (same arg helpers); `import-staff` calls `importStaff({ refresh: flag("refresh") })` and prints the counts; `create-owner` inserts an `employee_roles` owner role (`permissions` `["*"]`, `is_owner` 1) if none exists and an `employees` row with `hashPasswordSync(password)`.

- [ ] **Step 4: Run the isolation test** against a disposable MariaDB: apply `grants.sql` (edit the database name), then
`ISOLATION_MEMBER_URL=mysql://chok_member:...@127.0.0.1/lotto ISOLATION_ADMIN_URL=mysql://chok_admin:...@127.0.0.1/lotto npx vitest run src/server/db/isolation.test.ts` — expect `2 passed`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): DB users, grants, isolation test, db tooling"`

---

## Phase B — Cut-over (touches production; each task needs explicit go-ahead)

### Task 13: Runbook

**Files:** Create `$ADMIN/docs/runbook-cutover.md`.

- [ ] **Step 1: Write the runbook** with exactly these sections, each a numbered list of commands and a "verify" line:

  1. **Pre-flight.** Backup: `mysqldump --single-transaction lotto users staff_roles audit_log > pre-split.sql`. Check actor ids are all staff: `SELECT DISTINCT actor_id FROM audit_log WHERE actor_id IS NOT NULL AND actor_id NOT IN (SELECT id FROM users WHERE role='staff');` — expect 0 rows (repeat for `transactions.actor_id`, `bank_account_moves.actor_id`, `point_moves.actor_id`, `manual_limits.created_by`, `vouchers.created_by`, `blocklist.created_by`). Any row returned = a member id was written as an actor; stop and investigate.
  2. **Expand.** Deploy admin with `SCHEDULER=off`; `npm run db -- migrate`; `npm run db -- import-staff`; apply `grants.sql`; generate the member GRANT list from the member's tables minus admin tables and apply it.
  3. **Parallel run.** Team signs in at `https://admin.<domain>`. Rule: **employee changes (password, role, 2-step, new staff) are made in the old app only** until the switch.
  4. **Switch (maintenance window).** (a) put the member site in maintenance via settings; (b) stop member scheduler work: deploy member build from Task 14 (it no longer runs round/settlement/deposit/audit jobs); (c) `npm run db -- import-staff --refresh`; (d) set `SCHEDULER=on` in admin and restart; (e) change member `DATABASE_URL` to `chok_member`; (f) verify: staff login at admin, member login, place a bet, `SELECT * FROM employee_auth_log ORDER BY id DESC LIMIT 5`, round closes and settles (watch one tick), admin scheduler holds `chokprathan-admin:scheduler` (`SELECT IS_USED_LOCK('chokprathan-admin:scheduler')`).
  5. **Rollback (until contract).** Redeploy the previous member build, set `SCHEDULER=off` in admin, point member back to the old DB user. Staff rows in `users` are untouched, so the old console works again.
  6. **Contract (after 1–2 weeks).** Backup again, deploy member migration 9 (Task 15), confirm `SELECT COUNT(*) FROM users WHERE role='staff'` was 0 after the delete.

- [ ] **Step 2: Commit** — `git add -A && git commit -m "docs: cut-over runbook"`

### Task 14: Member app — stop owning the back office (deploy at Switch)

**Files ($MEMBER):** Delete `src/app/[lang]/admin/`, `src/app/[lang]/console/`, `src/components/admin/`, `src/server/actions/admin.ts`, `src/server/data/{admin,reports,dashboard}.ts`, `src/server/services/{staff,audit,audit-chain}.ts` (+tests), `src/domain/{permissions,doors}.ts` only if unused after the deletes. Modify `src/proxy.ts`, `src/server/services/scheduler.ts`, `src/server/services/auth.ts`, `src/server/session.ts`, `src/app/media/[name]/route.ts`, `src/server/db/seed.ts`, `scripts/db.ts`.

- [ ] **Step 1: Write failing member tests** in `src/server/services/auth.test.ts` (extend the existing file):

```ts
it("a staff row in users cannot sign in as a member", async () => {
  // after Task 14 the member login only knows members
  await run("INSERT INTO users (id, username, password_hash, name, role, ref_code, created_at) VALUES (900, 'boss', ?, 'Boss', 'staff', 'ZZZZZZ', 1)", await hashPassword("pw-12345"));
  expect(await checkLogin("boss", "pw-12345", { ip: null, userAgent: null })).toMatchObject({ ok: false });
});
```
Run → this already passes for phone logins; it guards the contract step. Add a proxy-level assertion by extracting the rule: in `src/server/proxy-auth.ts` (member) add `export const isRemovedPath = (logical: string) => /^\/(admin|console)(\/|$)/.test(logical);` with a test `expect(isRemovedPath("/admin/members")).toBe(true)` and `expect(isRemovedPath("/lotto")).toBe(false)`.

- [ ] **Step 2: Delete and edit.**
  - `git rm -r` the paths above, then `npm run typecheck` and fix every remaining import.
  - `src/proxy.ts`: remove `STAFF_COOKIE`, the `/admin/login` redirect, the whole `isAdmin` block and the `?ended` handling for `/console`; add at the top of the matching logic: `if (isRemovedPath(logical)) return new NextResponse(null, { status: 404 });`.
  - `src/server/services/scheduler.ts`: remove `ensureRounds`, `autoResults`, `resumeSettlements`, `settlePendingGuesses`, `expireDeposits`, `sealAudit`, `verifyAudit`, `rollupStats`, `simulateCrowd`; keep `pruneSessions`, `pruneRateLimits`, `syncCatalog`, `closeGameDay`; keep the lock name `chokprathan:scheduler`.
  - `src/server/services/auth.ts`: `checkLogin` loses `door`/staff branches (members only); remove `enableTotp`, `disableTotp`, `completeLoginChallenge`, `createLoginChallenge`, `STAFF_*`; `userFromToken` loses the staff join and idle rule; `sessionCookieName` returns `SESSION_COOKIE` only. Keep the `Role` type as is: Task 15 keeps the `role` column (every row is `"member"` after it).
  - `src/app/media/[name]/route.ts`: slips are served only to their owner (remove the `staff` branch and `STAFF_COOKIE`).
  - `seed.ts` / `scripts/db.ts`: remove `createStaff`, role seeding and the owner creation; `setup` now only migrates and seeds business data (owner creation moves to the admin repo's `create-owner`).
- [ ] **Step 3: Verify** — `npm test && npm run typecheck && npm run lint && npm run build`; `grep -rn "staff" src --include='*.ts' --include='*.tsx' | grep -v i18n` should only show the legacy `role` column in migrations/auth until Task 15.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "refactor: member app no longer serves the back office"`. **Do not deploy until Task 13 step 4 says so.**

### Task 15: Contract migration (member, 1–2 weeks after the switch)

**Files ($MEMBER):** Modify `src/server/db/migrations.ts` (append version 9), `src/server/db/migrations.ts` `APP_TABLES` (remove `staff_roles`), tests.

- [ ] **Step 1: Write the failing test** `src/server/db/contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasTestDb } from "@/test/db";
import { q1 } from "@/server/db";

const column = (col: string) =>
  q1("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?", col);

describe.skipIf(!hasTestDb)("contract migration 9", () => {
  it("removes the staff columns and staff_roles from the member schema", async () => {
    for (const col of ["staff_role_id", "totp_secret", "totp_enabled", "totp_last_step", "must_change_password"]) {
      expect(await column(col), col).toBeUndefined();
    }
    expect(await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles'")).toBeUndefined();
  });

  it("keeps users.role and users.staff_note (the admin filters role = 'member' and writes staff_note as the member note)", async () => {
    for (const col of ["role", "staff_note"]) expect(await column(col), col).toBeTruthy();
  });
});
```

- [ ] **Step 2: Append migration 9** (after confirming the runbook's backup exists)

```ts
  {
    version: 9,
    name: "remove staff from users",
    statements: [
      // Runs only after the admin runbook step 6.2 pre-check has passed: every users row with role = 'staff'
      // exists in employees with the same id (no staff missing from employees). This delete cannot be undone.
      "DELETE FROM users WHERE role = 'staff'",
      "ALTER TABLE users DROP FOREIGN KEY users_staff_role_fk",
      "ALTER TABLE users DROP COLUMN staff_role_id, DROP COLUMN totp_secret, DROP COLUMN totp_enabled, DROP COLUMN totp_last_step, DROP COLUMN must_change_password",
      "DROP TABLE IF EXISTS staff_roles",
    ],
  },
```
Deliberately NOT touched: `users.role` (the ENUM stays; afterwards every row is `'member'`), `users.staff_note` (the member
note, written by the admin) and the `users_role_created` index. So the `role = 'member'` filters in both apps keep working
and need no change; dropping `role` later is optional cleanup once neither app filters on it. Remove `staff_roles` from
`APP_TABLES`. `sessions.user_id` rows of deleted staff are removed by `ON DELETE CASCADE`.

- [ ] **Step 3: Run** `npm test` (expect the new test to pass and no regressions), `npm run typecheck`, `npm run lint`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(db): contract — drop staff from users"`.

### Task 16: Deployment files for the admin app

**Files ($ADMIN):** Modify `Dockerfile`, `ecosystem.config.cjs`, create `docker-compose.yml`, `deploy/nginx.conf`, `README.md`.

- [ ] **Step 1:** Copy `docker-compose.yml` and `deploy/nginx.conf` from `$MEMBER`; change the nginx `server_name` to `admin.<domain>`, listen port/upstream to the admin container, and add (commented) `allow <office-ip>; deny all;` lines for an optional IP allowlist; `deploy.replicas: 2` stays so the scheduler has a standby; use `env_file: .env.production.local` with the `.env.example` keys.
- [ ] **Step 2:** In `README.md` document: env vars, `npm run db -- migrate|import-staff|create-owner`, the parity rule ("money logic lives in two repos; run `scripts/check-parity.sh`"), the rule "employee data is edited only in this app after the switch", and the known limitation below.
- [ ] **Step 3: Build the image** — `docker build -t chokprathan-admin .` — expect success. **Step 4: Commit** — `git add -A && git commit -m "chore: admin deployment files and docs"`.

---

## Self-Review

**Spec coverage**
- Data split (spec §1): tables Task 2, id-preserving copy Task 4, `users` contract Task 15, DB users/GRANTs Tasks 12 & 13.
- Project structure and auth (§2): Tasks 1, 5, 8, 9.
- Scheduler (§3): Task 10 (admin side), Task 14 (member side), lock names differ, `SCHEDULER=off`.
- Cache TTL audit (§3): **gap** — add Task 17 below.
- Media (§3): Task 9 step 3 (admin slips), Task 14 (member slips owner-only); banners still served by member.
- AMB secrets (§3): Task 7 step 3 grep guard.
- Tests (§4): migration → Task 4; isolation → Task 12; parity → Task 11; member-side → Task 14/15.
- Order and rollback (§5): Tasks 13–15.

**Known limitations (state them to the user)**
- Historical staff sign-in logs (old `auth_log` rows / Mongo `auth_log`) stay in the member store as a read-only archive; the admin security page shows only `employee_auth_log` from the switch onward.
- `simulateCrowd` (staging load simulation) is dropped from the admin scheduler (it needs `placeBill`); the staging seed/demo stays in the member repo.
- Parity is enforced by surface/arity hash plus identical test files, not by shared code; a behavioural change must be made in both repos.

### Task 17: Cache TTL audit (member, before the Switch)

**Files ($MEMBER):** Modify the `memo(...)` call sites listed by the grep.

- [ ] **Step 1: List the cache keys the admin writes**

```bash
cd /Users/mckazine/Desktop/chokprathan
grep -rn "invalidate(" src --include='*.ts' | grep -v test | sed -E 's/^([^:]+):([0-9]+):.*invalidate\((.*)\).*/\1:\2 \3/'
grep -rn "memo(" src --include='*.ts' | grep -v test | sed -E 's/^([^:]+):([0-9]+):.*memo\(([^,]+), *([^,]+),.*/\1:\2 key=\3 ttl=\4/'
```
Each `invalidate(...)` called from an admin-triggered write matches a `memo` key read by the member site. Record the pairs in `docs/cache-ttl-audit.md`.

- [ ] **Step 2: Set TTLs.** For keys covering maintenance mode (`settings`), `blocklist`, `lottos`/round phase and `banners`, ensure `ttl <= 5_000` (5 s); anything longer that admin can change gets lowered to 5 s unless the read is expensive, in which case 30 s with a note in the audit file. Add a unit test per lowered key is not needed; the check is `grep` of the TTL constants in the audit file.
- [ ] **Step 3: Run** `npm test`; **commit** — `git add -A && git commit -m "perf(cache): short TTL for keys the back office writes"`.

(Do Task 17 before Task 13 step 4; it is listed last only so numbering above stays stable.)

---

## Plan amendments found during execution (2026-11-21)

Phase A (Tasks 1–12), Task 17 and Tasks 13/16 were executed in `chokprathan-admin`; these facts changed the plan:

1. **Task 15 (migration 9) keeps `users.role` and `users.staff_note` (resolved 2026-11-21).** Admin code filters `users.role = 'member'` in ~20 places (`actions/admin.ts`, `data/admin.ts`, `data/dashboard.ts`, `stats/build.ts`, `services/members.ts`, `services/blocklist.ts`) and uses `users.staff_note` as the *member note* (`actions/admin.ts` `UPDATE users SET staff_note`), so the original migration 9 (which dropped both) would have broken the admin. Decision: migration 9 deletes the staff rows (after the runbook pre-check that they all exist in `employees`), drops FK `users_staff_role_fk`, columns `staff_role_id`, `totp_secret`, `totp_enabled`, `totp_last_step`, `must_change_password`, and table `staff_roles`; it keeps `role`, `staff_note` and the `users_role_created` index. Afterwards every `users` row is a member, so the `role = 'member'` filters keep working: no admin code change is needed before migration 9, and `scripts/grants.sql` (`UPDATE (…, staff_note)`) stays as is. `importStaff` now requires `staff_roles`, `users.role` and `users.staff_role_id` to all exist and otherwise returns `{ roles: 0, employees: 0 }` without error (admin commit 9e59a89 "fix(import-staff): do nothing once the contract step has run"); before that fix it checked only `role` and would have failed with `ER_NO_SUCH_TABLE` after the contract step. Removing `role` later is optional cleanup once neither app filters on it.
2. **`memo` staleness (member, Task 17 follow-up, branch `admin-split/prep`, commit 3876161).** `memo` used to serve a stale value of any age; after the split the admin cannot invalidate the member process, so a quiet process could accept the first bet at an old rate. Fixed: stale values are served only up to 2x TTL. Worst case for `settings`/`lottos` (bet-relevant) is ~10 s (~5 s on a busy site); a hard 5 s ceiling would need 2.5 s TTLs (double the queries).
3. **Member DDL.** `chok_member` has no DDL rights. The member app must run with `DB_AUTO_MIGRATE=false` and migrations run with a separate privileged user (runbook step 0a). `grants.sql` must be applied after the member migrations.
4. **Employee ids vs member ids.** `employees.id` keeps old staff ids, so new employees would reuse ids that exist in `users`. Optional runbook step 2.5 sets `ALTER TABLE employees AUTO_INCREMENT = 1000000000` (fits INT). Decide before Switch.
5. **Maintenance mode** does not exist in the member app; the runbook uses an nginx 503 switch.
6. **Parity script** (`scripts/check-parity.sh`) passes only after branch `admin-split/prep` is merged into member `main`.
7. **Counts/names:** the back office has 24 pages (not 26); login action names are `loginAction`/`logoutAction`; AMB secrets are not given to admin (games page lost its API/callback card and sync button).
8. **Test database:** the available test DB already contained the member schema (and a production install flag); the Task 4 test needs FK checks off in its fixture. Member-table service tests (rounds, finance, settlement, blocklist, points) have NOT been run in the admin repo; they need an empty disposable database with the member schema.
9. **No Docker (decision 2026-11-21).** Task 16's Dockerfile/compose files were removed from `chokprathan-admin`; the admin app deploys with PM2 behind nginx (`ecosystem.config.cjs`, `deploy/nginx.conf`, upstream `127.0.0.1:3100`). The local-Docker verification run (member schema + isolation test on a throwaway MariaDB) was dropped with it; those proofs still need a disposable MariaDB with the member schema.
