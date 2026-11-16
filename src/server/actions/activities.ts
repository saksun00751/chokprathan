"use server";

import { refresh } from "next/cache";
import type { Dict } from "@/i18n/dictionaries";
import { errorsT } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { placeGuess, spinWheel, type PlayError } from "@/server/services/activities";
import { limitLocal } from "@/server/services/ratelimit";
import { getViewer } from "@/server/session";

async function member() {
  const viewer = await getViewer();
  return viewer && viewer.role === "member" ? viewer : null;
}

function playMessage(e: Dict["errors"], code: PlayError): string {
  const m: Record<PlayError, string> = {
    off: e.activities.off,
    points: e.activities.points,
    limit: e.activities.limit,
    budget: e.activities.budget,
    round: e.activities.round,
    number: e.activities.number,
    taken: e.activities.taken,
    max: e.activities.max,
    blocked: e.auth.accountBlocked,
    notReady: e.activities.notReady,
  };
  return m[code];
}

/**
 * Spin the lucky wheel. The page is not refreshed here: the wheel animates first, then the screen
 * refreshes its balances, so the result is not given away before the wheel stops.
 */
export async function spinWheelAction(): Promise<ActionResult<{ slot: number; prize: number; points: number; spinsLeft: number | null }>> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.memberOnly };
  if (!limitLocal(`wheel:${viewer.id}`, 6, 10_000).ok) return { ok: false, error: e.generic.tooFast };
  const r = await spinWheel(viewer.id);
  if (!r.ok) return { ok: false, error: playMessage(e, r.error) };
  return { ok: true, data: { slot: r.slot, prize: r.prize, points: r.points, spinsLeft: r.spinsLeft } };
}

/** Guess the bottom two digits of an open round. */
export async function placeGuessAction(roundId: number, number: string): Promise<ActionResult<{ points: number }>> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.memberOnly };
  if (!limitLocal(`guess:${viewer.id}`, 10, 10_000).ok) return { ok: false, error: e.generic.tooFast };
  if (!Number.isInteger(roundId) || roundId <= 0) return { ok: false, error: e.activities.round };
  const r = await placeGuess(viewer.id, roundId, String(number ?? ""));
  if (!r.ok) return { ok: false, error: playMessage(e, r.error) };
  refresh();
  return { ok: true, message: e.activities.guessed, data: { points: r.points } };
}
