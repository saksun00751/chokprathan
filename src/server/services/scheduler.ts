import "server-only";
import { hostname } from "node:os";
import { outsideTx, q1, run, tolerateMissingTable, withLock } from "@/server/db";
import { invalidate } from "@/server/cache";
import { ambReady } from "@/server/amb";
import { closeGameDay, syncCatalog } from "./games";
import { dayKey, dayStartMs } from "@/domain/time";
import { pruneSessions } from "./auth";
import { pruneRateLimits } from "./ratelimit";

/**
 * Background work the member site still owns: clean up old sessions and rate-limit rows, refresh
 * the game catalog once a day, and close yesterday's games. Rounds, results, settlement, deposit
 * expiry, the audit chain and the report summaries are run by the back-office app's scheduler (its
 * own lock, `chokprathan-admin:scheduler`). Every app instance runs the timer, but a MariaDB named
 * lock lets only one of them do the work at a time.
 */
type State = {
  timer?: ReturnType<typeof setInterval>;
  lastTick: number;
  lastPrune: number;
  lastCatalogCheck?: number;
  lastGameClose?: number;
  ticking: boolean;
};
const state = ((globalThis as unknown as { __chokprathanScheduler?: State }).__chokprathanScheduler ??= {
  lastTick: 0,
  lastPrune: 0,
  ticking: false,
});

const TICK_MS = 20_000;
const PRUNE_EVERY = 60 * 60_000;

export async function tick(now = Date.now()) {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const r = await withLock("chokprathan:scheduler", async () => {
      if (now - state.lastPrune > PRUNE_EVERY) {
        await pruneSessions(now);
        await pruneRateLimits(now);
        state.lastPrune = now;
      }
      // Its own heartbeat row: 'scheduler' belongs to the back-office scheduler (rounds and payouts),
      // whose health checks must not be masked by this one.
      await run(
        "INSERT INTO system_status (name, `value`, updated_at) VALUES ('member_scheduler', ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = VALUES(updated_at)",
        JSON.stringify({ host: hostname(), pid: process.pid }),
        now,
      );
    });
    if (r.ran) state.lastTick = now;
  } finally {
    state.ticking = false;
  }
  // The game catalog refreshes once a day, on its own lock.
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
