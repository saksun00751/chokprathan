"use server";

import { refresh } from "next/cache";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { clientInfo } from "@/server/request";
import { authLog, changePassword } from "@/server/services/auth";
import { limitShared, retryText } from "@/server/services/ratelimit";
import { getViewer } from "@/server/session";

/** Members change their password on /account (member session). */
export async function changePasswordAction(current: string, next: string, confirm: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const e = await errorsT();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (typeof next !== "string" || typeof current !== "string") return { ok: false, error: e.generic.invalid };
  const limit = await limitShared(`pwchange:${viewer.id}`, 10, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.account.tooOften, { wait: retryText(limit.retryAfterMs, e) }) };
  const problem = next.length < 8 ? e.account.newShort : null;
  if (problem) return { ok: false, error: problem, fieldErrors: { next: problem } };
  if (next.length > 64) return { ok: false, error: e.account.tooLong, fieldErrors: { next: e.account.tooLong } };
  if (next !== confirm) return { ok: false, error: e.account.newMismatch, fieldErrors: { confirm: e.account.newMismatch } };
  const r = await changePassword(viewer.id, current, next);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: { current: r.error } };
  await authLog("password_changed", viewer.id, null, await clientInfo());
  refresh();
  return { ok: true, message: e.account.changed };
}
