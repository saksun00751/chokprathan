/**
 * Concurrency and load test against a DISPOSABLE database (it empties every table first).
 *
 *   ALLOW_DB_RESET=yes-destroy-data npm run loadtest -- --users 60 --bets 600 --concurrency 24
 *
 * Fires many simultaneous bills at a few hot numbers (so the rate-cut tiers and caps are hit
 * under contention), then checks the invariants that must hold whatever the interleaving:
 *   1. every number's exposure equals the sum of its bill items
 *   2. no number passes its cap
 *   3. every wallet equals its starting balance plus its ledger rows
 *   4. after the draw, payouts equal the winning items' potential and the ledger still balances
 * Uses TEST_DATABASE_URL (from .env.local) and refuses a production install.
 */
import { performance } from "node:perf_hooks";
import { dayKey } from "@/domain/time";
import { setCacheEnabled } from "@/server/cache";
import { closePool, insertMany, json, q, q1, run } from "@/server/db";
import { migrate, truncateAppTables } from "@/server/db/migrate";
import { placeBill, type SlipLine } from "@/server/services/bills";
import { setResult } from "@/server/services/rounds";

const args = process.argv.slice(2);
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const USERS = num("users", 40);
const BILLS = num("bets", 300);
const CONCURRENCY = num("concurrency", 16);
const START_BALANCE = 2_000_000; // ฿20,000 each

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

async function main() {
  if (process.env.ALLOW_DB_RESET !== "yes-destroy-data") throw new Error("Set ALLOW_DB_RESET=yes-destroy-data: this script empties the database");
  setCacheEnabled(false);
  await migrate();
  await truncateAppTables();

  const now = Date.now();
  const lottoId = (
    await run(
      `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, result_delay_min, auto_result, rates, limits, risk)
       VALUES ('load', 'หวยทดสอบโหลด', 'ทดสอบ', 'foreign', 'standard', ?, 1, 0, '{}', '{}', ?)`,
      json.str({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], close: "23:59" }),
      json.str({ top2: { enabled: true, tiers: [{ threshold: 3000, percent: 75 }, { threshold: 8000, percent: 50 }], cap: 15000 } }),
    )
  ).lastId;
  const roundId = (
    await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, ?, ?, ?, ?)", lottoId, dayKey(now), now - 3_600_000, now + 3_600_000, now + 3_660_000)
  ).lastId;
  await insertMany(
    "users",
    ["phone", "password_hash", "name", "ref_code", "balance", "created_at"],
    Array.from({ length: USERS }, (_, i) => [`0900${String(i).padStart(6, "0")}`, "x", `โหลด ${i}`, `LD${String(i).padStart(6, "0")}`, START_BALANCE, now]),
  );
  const users = (await q<{ id: number }>("SELECT id FROM users ORDER BY id")).map((u) => u.id);

  const HOT = ["11", "22", "33"];
  const lineFor = (i: number): SlipLine[] => {
    const lines: SlipLine[] = [{ betType: "top2", number: HOT[i % HOT.length], stake: 100 + (i % 5) * 100 }];
    if (i % 3 === 0) lines.push({ betType: "bottom2", number: String(i % 100).padStart(2, "0"), stake: 50 });
    if (i % 4 === 0) lines.push({ betType: "top3", number: String((i * 7) % 1000).padStart(3, "0"), stake: 20 });
    return lines;
  };

  console.log(`placing ${BILLS} bills from ${USERS} members, ${CONCURRENCY} at a time...`);
  const latencies: number[] = [];
  const outcomes = new Map<string, number>();
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= BILLS) return;
        const s = performance.now();
        const r = await placeBill(users[i % users.length], roundId, lineFor(i), { now: Date.now(), acceptChanges: true });
        latencies.push(performance.now() - s);
        const key = r.ok ? "placed" : r.error;
        outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(0);
  console.log(`  ${BILLS} bills in ${secs.toFixed(1)}s = ${(BILLS / secs).toFixed(1)} bills/s; latency p50 ${pct(50)}ms p95 ${pct(95)}ms p99 ${pct(99)}ms`);
  console.log(`  outcomes: ${[...outcomes].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const problems: string[] = [];
  const drift = await q<{ bet_type: string; number: string; e: number; s: number }>(
    `SELECT e.bet_type, e.number, e.total_stake AS e, COALESCE(SUM(i.stake), 0) AS s FROM exposures e
     LEFT JOIN bill_items i ON i.round_id = e.round_id AND i.bet_type = e.bet_type AND i.number = e.number AND i.status = 'pending'
     WHERE e.round_id = ? GROUP BY e.bet_type, e.number, e.total_stake HAVING e <> s`,
    roundId,
  );
  if (drift.length) problems.push(`exposure drift on ${drift.length} numbers, e.g. ${JSON.stringify(drift[0])}`);
  const over = await q("SELECT number, total_stake FROM exposures WHERE round_id = ? AND bet_type = 'top2' AND total_stake > 15000", roundId);
  if (over.length) problems.push(`cap broken on ${over.length} numbers`);
  const ledger = async () =>
    q<{ id: number }>(
      `SELECT u.id FROM users u WHERE u.balance <> ? + COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id AND t.wallet = 'balance'), 0)
         OR u.cashback_balance <> COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id AND t.wallet = 'cashback'), 0)`,
      START_BALANCE,
    );
  const before = await ledger();
  if (before.length) problems.push(`${before.length} wallets disagree with their ledger before the draw`);
  const negative = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE balance < 0");
  if (negative?.n) problems.push(`${negative.n} negative balances`);

  console.log("drawing and settling...");
  await run("UPDATE rounds SET closes_at = ?, draw_at = ? WHERE id = ?", Date.now() - 1, Date.now() - 1, roundId);
  const s1 = performance.now();
  const drawn = await setResult(roundId, { top3: "511", bottom2: "22" }, null);
  if (!drawn.ok) problems.push(`draw failed: ${drawn.error}`);
  console.log(`  settled in ${((performance.now() - s1) / 1000).toFixed(1)}s`);
  const payout = await q1<{ paid: number | null; expected: number | null }>(
    `SELECT (SELECT SUM(total_payout) FROM bills WHERE round_id = ?) AS paid,
            (SELECT SUM(potential) FROM bill_items WHERE round_id = ? AND status = 'won') AS expected`,
    roundId,
    roundId,
  );
  if ((payout?.paid ?? 0) !== (payout?.expected ?? 0)) problems.push(`payout mismatch: paid ${payout?.paid} vs expected ${payout?.expected}`);
  const pending = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM bills WHERE round_id = ? AND status = 'pending'", roundId);
  if (pending?.n) problems.push(`${pending.n} bills still pending after settlement`);
  const after = await ledger();
  if (after.length) problems.push(`${after.length} wallets disagree with their ledger after the draw`);

  console.log(problems.length ? `FAILED\n  - ${problems.join("\n  - ")}` : "ALL INVARIANTS HOLD");
  process.exitCode = problems.length ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
