"use server";

import { errorsT, serverLocale } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { limitLocal } from "@/server/services/ratelimit";
import { launchGame } from "@/server/services/games";
import { getViewer } from "@/server/session";

/** A game URL for the signed-in member; the browser goes there next. */
export async function launchGameAction(productId: string, gameCode: string, mobile: boolean): Promise<ActionResult<{ url: string }>> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "member") return { ok: false, error: e.generic.memberOnly };
  if (!limitLocal(`launch:${viewer.id}`, 12, 60_000).ok) return { ok: false, error: e.generic.tooFast };
  if (typeof productId !== "string" || typeof gameCode !== "string" || productId.length > 40 || gameCode.length > 120)
    return { ok: false, error: e.games.notFound };
  const r = await launchGame(viewer.id, productId, gameCode, mobile === true, await serverLocale());
  if (!r.ok) return { ok: false, error: { off: e.games.off, notFound: e.games.notFound, blocked: e.auth.accountBlocked, failed: e.games.failed }[r.error] };
  return { ok: true, data: { url: r.url } };
}
