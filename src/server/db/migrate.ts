import "server-only";
import { pinned, q, q1, run, withLock } from "./index";
import { APP_TABLES, MIGRATIONS } from "./migrations";

/** Apply every pending migration. Safe to call from several processes at once. */
export async function migrate(log: (line: string) => void = () => {}): Promise<number> {
  const result = await withLock(
    "chokprathan:migrate",
    async () => {
      await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        applied_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const done = new Set((await q<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => r.version));
      let applied = 0;
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        for (const statement of m.statements) await run(statement);
        await run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", m.version, m.name, Date.now());
        log(`[db] migration ${m.version} applied: ${m.name}`);
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
  const exists = await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
  if (!exists) return 0;
  return (await q1<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations"))?.v ?? 0;
}

/** How this database was installed. Destructive tooling refuses to touch a production install. */
export async function installMode(): Promise<"production" | "staging" | null> {
  const exists = await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings'");
  if (!exists) return null;
  const row = await q1<{ value: string }>("SELECT `value` FROM settings WHERE `key` = 'install'");
  if (!row) return null;
  try {
    const mode = (JSON.parse(row.value) as { mode?: string }).mode;
    return mode === "production" || mode === "staging" ? mode : null;
  } catch {
    return null;
  }
}

/**
 * Drop every table this app owns. Only for disposable databases: refuses a production install
 * and requires ALLOW_DB_RESET=yes-destroy-data.
 */
export async function dropAppTables(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== "yes-destroy-data") throw new Error("Refusing to drop tables: set ALLOW_DB_RESET=yes-destroy-data");
  if ((await installMode()) === "production") throw new Error("Refusing to drop tables: this database is a production install");
  await withLock(
    "chokprathan:migrate",
    () =>
      pinned(async () => {
        await run("SET FOREIGN_KEY_CHECKS = 0");
        try {
          for (const table of APP_TABLES) await run(`DROP TABLE IF EXISTS ${table}`);
        } finally {
          await run("SET FOREIGN_KEY_CHECKS = 1");
        }
      }),
    60,
  );
}

/** Empty every app table but keep the schema (test runs). Same guards as dropAppTables. */
export async function truncateAppTables(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== "yes-destroy-data") throw new Error("Refusing to truncate: set ALLOW_DB_RESET=yes-destroy-data");
  if ((await installMode()) === "production") throw new Error("Refusing to truncate: this database is a production install");
  await pinned(async () => {
    await run("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of APP_TABLES) if (table !== "schema_migrations") await run(`TRUNCATE TABLE ${table}`);
    } finally {
      await run("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}
