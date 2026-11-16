import "server-only";
import { createHash, randomInt } from "node:crypto";
import { hostname } from "node:os";
import { betTypesFor } from "@/domain/betTypes";
import type { BetTypeCode, ResultFormat } from "@/domain/types";
import { outsideTx, q, q1, run, tolerateMissingTable, withLock } from "@/server/db";
import { invalidate } from "@/server/cache";
import { ambReady } from "@/server/amb";
import { closeGameDay, syncCatalog } from "./games";
import { dayKey, dayStartMs } from "@/domain/time";
import { pruneSessions } from "./auth";
import { placeBill, type SlipLine } from "./bills";
import { expireDeposits } from "./finance";
import { pruneRateLimits } from "./ratelimit";
import { autoResults, ensureRounds, resumeSettlements } from "./rounds";
import { settlePendingGuesses } from "./activities";
import { getSettings } from "./settings";
import { rollupStats } from "@/server/stats/rollup";
import { sealAudit, verifyAudit } from "./audit";

/**
 * Background work: create upcoming rounds, draw auto-result rounds, finish interrupted
 * settlements, expire deposits, and clean up old rows. Every app instance runs the timer, but
 * a MariaDB named lock lets only one of them do the work at a time.
 */
type State = {
  timer?: ReturnType<typeof setInterval>;
  lastTick: number;
  lastEnsure: number;
  lastPrune: number;
  lastStats?: number;
  lastVerify?: number;
  lastCatalogCheck?: number;
  lastGameClose?: number;
  ticking: boolean;
};
const state = ((globalThis as unknown as { __chokprathanScheduler?: State }).__chokprathanScheduler ??= {
  lastTick: 0,
  lastEnsure: 0,
  lastPrune: 0,
  ticking: false,
});

const TICK_MS = 20_000;
const ENSURE_EVERY = 5 * 60_000;
const PRUNE_EVERY = 60 * 60_000;
/** Dashboard and report summaries in MongoDB (no-op without MongoDB). */
const STATS_EVERY = 60_000;
/** Full walk of the audit hash chain (sealing runs every tick). */
const VERIFY_EVERY = 6 * 60 * 60_000;

export async function tick(now = Date.now()) {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const r = await withLock("chokprathan:scheduler", async () => {
      if (now - state.lastEnsure > ENSURE_EVERY) {
        await ensureRounds(now);
        state.lastEnsure = now;
      }
      await autoResults(now);
      await resumeSettlements(now);
      await settlePendingGuesses(now).catch((error) => console.error("[scheduler] guess settlement failed:", error instanceof Error ? error.message : error));
      await expireDeposits(now);
      if (now - state.lastPrune > PRUNE_EVERY) {
        await pruneSessions(now);
        await pruneRateLimits(now);
        state.lastPrune = now;
      }
      if ((await getSettings()).site.simulateCrowd) await simulateCrowd(now);
      await sealAudit(now).catch((error) => console.error("[scheduler] audit sealing failed:", error instanceof Error ? error.message : error));
      if (now - (state.lastVerify ?? 0) >= VERIFY_EVERY) {
        state.lastVerify = now;
        await verifyAudit(now).catch((error) => console.error("[scheduler] audit verification failed:", error instanceof Error ? error.message : error));
      }
      if (now - (state.lastStats ?? 0) >= STATS_EVERY) {
        state.lastStats = now;
        // Summaries are rebuilt on read when stale, so a failure here only costs speed, never numbers.
        await rollupStats(now).catch((error) => console.error("[scheduler] stats rollup failed:", error instanceof Error ? error.message : error));
      }
      await run(
        "INSERT INTO system_status (name, `value`, updated_at) VALUES ('scheduler', ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = VALUES(updated_at)",
        JSON.stringify({ host: hostname(), pid: process.pid }),
        now,
      );
    });
    if (r.ran) state.lastTick = now;
  } finally {
    state.ticking = false;
  }
  // The game catalog refreshes once a day, on its own lock, never holding up results or payouts.
  void refreshGameCatalog(now);
  void closeYesterdayGames(now);
}

/** Half an hour after midnight (Bangkok), yesterday's games are closed and their cashback paid. */
async function closeYesterdayGames(now: number) {
  if (now - (state.lastGameClose ?? 0) < 10 * 60_000) return;
  const today = dayKey(now);
  if (now - dayStartMs(today) < 30 * 60_000) return;
  state.lastGameClose = now;
  try {
    await withLock("chokprathan:game-day", () => closeGameDay(dayKey(dayStartMs(today) - 1), now));
  } catch (error) {
    console.error("[scheduler] closing the game day failed:", error instanceof Error ? error.message : error);
  }
}

const CATALOG_EVERY = 24 * 60 * 60_000;

async function refreshGameCatalog(now: number) {
  if (!ambReady() || now - (state.lastCatalogCheck ?? 0) < 10 * 60_000) return;
  state.lastCatalogCheck = now;
  try {
    const last = await tolerateMissingTable(() => q1<{ t: number | null }>("SELECT MAX(synced_at) AS t FROM game_products"), undefined);
    if (last === undefined || (last.t && now - Number(last.t) < CATALOG_EVERY)) return;
    await withLock("chokprathan:games-sync", () => syncCatalog(now));
    invalidate("games:");
  } catch (error) {
    console.error("[scheduler] game catalog sync failed:", error instanceof Error ? error.message : error);
  }
}

/** Start the timer once per process (called from instrumentation at server start). */
export function startScheduler() {
  if (state.timer || process.env.SCHEDULER === "off") return;
  // Never inherit a request's transaction context.
  outsideTx(() => {
    state.timer = setInterval(() => {
      tick().catch((error) => console.error("[scheduler] tick failed", error));
    }, TICK_MS);
    state.timer.unref?.();
    tick().catch((error) => console.error("[scheduler] first tick failed", error));
  });
}

export const schedulerState = () => ({ running: !!state.timer, lastTick: state.lastTick });

/* ---------- demo crowd (staging and demos only) ---------- */

const pick = <T>(list: readonly T[]) => list[randomInt(0, list.length)];

/** Three "hot" numbers per round and bet type, stable for the round so they build up exposure. */
export function hotNumbers(roundId: number, betType: BetTypeCode, digits: number): string[] {
  const h = createHash("sha1").update(`${roundId}:${betType}`).digest();
  return [0, 1, 2].map((i) => String(h.readUInt32BE(i * 4) % 10 ** digits).padStart(digits, "0"));
}

const DIGITS: Record<BetTypeCode, number> = {
  top4: 4,
  top3: 3,
  tod3: 3,
  front3: 3,
  bottom3: 3,
  top2: 2,
  bottom2: 2,
  runTop: 1,
  runBottom: 1,
};

const WEIGHTED: BetTypeCode[] = ["top2", "top2", "top2", "bottom2", "bottom2", "bottom2", "top3", "top3", "tod3", "runTop", "runBottom"];

/** Simulated members bet a little every tick so a demo shows exposure and automatic rate cuts. */
async function simulateCrowd(now: number) {
  const crowd = await q<{ id: number }>("SELECT id FROM users WHERE is_simulated = 1 AND status = 'active' LIMIT 100");
  if (crowd.length === 0) return;
  const open = await q<{ id: number; format: ResultFormat }>(
    `SELECT r.id, l.format FROM rounds r JOIN lottos l ON l.id = r.lotto_id
     WHERE r.status = 'scheduled' AND r.opens_at <= ? AND r.closes_at > ? AND r.closes_at <= ?
     ORDER BY r.closes_at LIMIT 14`,
    now,
    now + 60_000,
    now + 6 * 3_600_000,
  );
  if (open.length === 0) return;
  const count = randomInt(0, 3);
  for (let i = 0; i < count; i++) {
    const round = pick(open);
    const allowed = new Set(betTypesFor(round.format));
    const lines: SlipLine[] = Array.from({ length: randomInt(1, 4) }, () => {
      let betType = pick(WEIGHTED);
      if (!allowed.has(betType)) betType = "top2";
      const digits = DIGITS[betType];
      const number = randomInt(0, 10) < 6 ? pick(hotNumbers(round.id, betType, digits)) : String(randomInt(0, 10 ** digits)).padStart(digits, "0");
      return { betType, number, stake: pick([20, 50, 100, 100, 200, 300, 500]) };
    });
    await placeBill(pick(crowd).id, round.id, lines, { now, acceptChanges: true });
  }
}
