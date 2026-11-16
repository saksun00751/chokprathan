"use server";

import { refresh } from "next/cache";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { otpauthUri, newTotpSecret } from "@/server/totp";
import { clientInfo } from "@/server/request";
import { authLog, changePassword, disableTotp, enableTotp, revokeAllSessions, staffPasswordProblem, verifyPassword, type SessionUser } from "@/server/services/auth";
import { q1 } from "@/server/db";
import { limitShared, retryText } from "@/server/services/ratelimit";
import { getStaff, getViewer } from "@/server/session";
import { getSetting } from "@/server/services/settings";
import { BRAND } from "@/config/brand";
import QRCode from "qrcode";

/** Members change their password on /account (member session). */
export async function changePasswordAction(current: string, next: string, confirm: string): Promise<ActionResult> {
  return changeOwnPassword(await getViewer(), current, next, confirm);
}

/** Staff change theirs on /admin/security (console session), with the stricter staff rules. */
export async function changeStaffPasswordAction(current: string, next: string, confirm: string): Promise<ActionResult> {
  return changeOwnPassword(await getStaff(), current, next, confirm);
}

async function changeOwnPassword(viewer: SessionUser | null, current: string, next: string, confirm: string): Promise<ActionResult> {
  const e = await errorsT();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (typeof next !== "string" || typeof current !== "string") return { ok: false, error: e.generic.invalid };
  const limit = await limitShared(`pwchange:${viewer.id}`, 10, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.account.tooOften, { wait: retryText(limit.retryAfterMs, e) }) };
  const problem = viewer.role === "staff" ? staffPasswordProblem(next, e) : next.length < 8 ? e.account.newShort : null;
  if (problem) return { ok: false, error: problem, fieldErrors: { next: problem } };
  if (next.length > 64) return { ok: false, error: e.account.tooLong, fieldErrors: { next: e.account.tooLong } };
  if (next !== confirm) return { ok: false, error: e.account.newMismatch, fieldErrors: { confirm: e.account.newMismatch } };
  const r = await changePassword(viewer.id, current, next);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: { current: r.error } };
  await authLog("password_changed", viewer.id, null, await clientInfo());
  refresh();
  return { ok: true, message: e.account.changed };
}

/** Step 1 of turning on two-step sign-in: a fresh secret the staff member adds to their app. */
export async function startTotpSetupAction(): Promise<ActionResult<{ secret: string; qr: string }>> {
  const e = await errorsT();
  const viewer = await getStaff();
  if (!viewer || viewer.role !== "staff") return { ok: false, error: e.generic.staffOnly };
  const secret = newTotpSecret();
  const uri = otpauthUri(secret, viewer.username ?? `staff-${viewer.id}`, BRAND.nameLatin);
  const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 220 });
  return { ok: true, data: { secret, qr } };
}

/** Step 2: the code from the app proves the secret was saved; only then is it stored. */
export async function confirmTotpSetupAction(secret: string, code: string): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await getStaff();
  if (!viewer || viewer.role !== "staff") return { ok: false, error: e.generic.staffOnly };
  if (typeof secret !== "string" || !/^[A-Z2-7]{32}$/.test(secret)) return { ok: false, error: e.account.totpRestart };
  if (!(await enableTotp(viewer.id, secret, String(code ?? "")))) return { ok: false, error: e.account.totpWrong };
  await authLog("2fa_enabled", viewer.id, null, await clientInfo());
  refresh();
  return { ok: true, message: e.account.totpOn };
}

export async function disableTotpAction(password: string): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await getStaff();
  if (!viewer || viewer.role !== "staff") return { ok: false, error: e.generic.staffOnly };
  if ((await getSetting("site")).staffTotpRequired) return { ok: false, error: e.account.totpRequired };
  const row = await q1<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", viewer.id);
  if (!row || !(await verifyPassword(String(password ?? ""), row.password_hash))) return { ok: false, error: e.account.passwordWrong };
  await disableTotp(viewer.id);
  await revokeAllSessions(viewer.id);
  await authLog("2fa_disabled", viewer.id, null, await clientInfo());
  return { ok: true, message: e.account.totpOff };
}
