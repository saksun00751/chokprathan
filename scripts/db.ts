/**
 * Database tooling. Run with: npm run db -- <command> [options]
 *
 *   status                         schema version, install mode, row counts
 *   migrate                        apply pending migrations
 *   setup --mode production|staging
 *                                  migrate and add essentials (lotto catalog, banners, promotions, games)
 *   seed-demo                      add demo members and history (staging installs only)
 *   reset --yes                    drop every app table (refused on production installs)
 *   media-to-mongo                 move uploaded images from MariaDB into MongoDB GridFS
 *   stats-rebuild                  rebuild every dashboard/report summary in MongoDB from MariaDB
 *
 * Staff accounts (the first owner included) are created in the back-office app:
 *   cd ../chokprathan-admin && npm run db -- create-owner --username U --password P
 *
 * Reads DATABASE_URL from the environment (.env.local is loaded by the npm script).
 */
import { closePool, q, q1 } from "@/server/db";
import { dropAppTables, installMode, migrate, schemaVersion } from "@/server/db/migrate";
import { seedDemo, seedEssentials, type InstallMode } from "@/server/db/seed";
import { setCacheEnabled } from "@/server/cache";
import { gridStore } from "@/server/media-store";
import { closeMongo, ensureMongoIndexes, MEDIA_BUCKET, mongoDb } from "@/server/mongo";
import { mariaMediaStore } from "@/server/uploads";
import { rebuildAllStats } from "@/server/stats/rollup";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const log = (line: string) => console.log(line);

async function main() {
  setCacheEnabled(false);
  switch (cmd) {
    case "status": {
      const version = await schemaVersion();
      log(`schema version: ${version}`);
      if (version > 0) {
        log(`install mode: ${(await installMode()) ?? "(not set)"}`);
        for (const t of ["users", "lottos", "rounds", "bills", "transactions", "deposits", "withdrawals"]) {
          const r = await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
          log(`  ${t.padEnd(14)} ${r?.n ?? 0}`);
        }
      }
      break;
    }
    case "migrate": {
      const n = await migrate(log);
      log(n ? `applied ${n} migration(s)` : "schema is up to date");
      break;
    }
    case "setup": {
      const mode = opt("mode") as InstallMode | undefined;
      if (mode !== "production" && mode !== "staging") throw new Error("--mode production|staging is required");
      await migrate(log);
      const existingMode = await installMode();
      if (existingMode && existingMode !== mode) throw new Error(`this database is already a ${existingMode} install`);
      const r = await seedEssentials({ mode });
      log(r.created.length ? `created: ${r.created.join(", ")}` : "essentials already present");
      log("next: create the first owner account in the back-office app (npm run db -- create-owner there)");
      break;
    }
    case "seed-demo": {
      await seedDemo({ log });
      break;
    }
    case "reset": {
      if (!flag("yes")) throw new Error("add --yes to drop every table");
      process.env.ALLOW_DB_RESET = "yes-destroy-data";
      await dropAppTables();
      log("dropped all app tables");
      break;
    }
    case "media-to-mongo": {
      // Copy each image from MariaDB into GridFS, compare the bytes, then delete the MariaDB copy.
      const db = await mongoDb();
      if (!db) throw new Error("MONGODB_URL is not set or MongoDB cannot be reached");
      await ensureMongoIndexes(log);
      const grid = await gridStore(db, MEDIA_BUCKET);
      let after = "";
      let moved = 0;
      let kept = 0;
      for (;;) {
        const rows = await q<{ name: string }>("SELECT name FROM media WHERE name > ? ORDER BY name LIMIT 50", after);
        if (rows.length === 0) break;
        for (const { name } of rows) {
          after = name;
          const file = await mariaMediaStore.get(name);
          if (!file) continue;
          if (!(await grid.get(name))) await grid.put(file);
          const copy = await grid.get(name);
          if (copy?.bytes.equals(file.bytes)) {
            await mariaMediaStore.remove(name);
            moved++;
          } else {
            kept++;
            log(`  kept in MariaDB (copy did not match): ${name}`);
          }
        }
      }
      log(`moved ${moved} image(s) to MongoDB${kept ? `, ${kept} kept in MariaDB` : ""}`);
      break;
    }
    case "stats-rebuild": {
      await ensureMongoIndexes(log);
      await rebuildAllStats(log);
      break;
    }
    default:
      log("commands: status | migrate | setup | seed-demo | reset | media-to-mongo | stats-rebuild");
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closePool(), closeMongo()]));
