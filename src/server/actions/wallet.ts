"use server";

import { refresh } from "next/cache";
import { formatBaht } from "@/domain/money";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { attachSlip, cancelDeposit, confirmDeposit, createDeposit, requestWithdrawal, type Deposit } from "@/server/services/finance";
import { limitLocal, limitShared, retryText } from "@/server/services/ratelimit";
import { claimCashback, redeemVoucher, transferAffiliate } from "@/server/services/retention";
import { removeImage, saveImage } from "@/server/uploads";
import { getViewer } from "@/server/session";

async function member() {
  const viewer = await getViewer();
  return viewer && viewer.role === "member" ? viewer : null;
}

const toSatang = (baht: unknown) => {
  const n = Number(baht);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n) * 100 : NaN;
};

export async function createDepositAction(amountBaht: number, promotionId: number | null): Promise<ActionResult<Deposit>> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.memberOnly };
  const limit = await limitShared(`deposit:${viewer.id}`, 15, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.wallet.depositBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const amount = toSatang(amountBaht);
  if (Number.isNaN(amount)) return { ok: false, error: e.wallet.enterAmount };
  const r = await createDeposit(viewer.id, amount, Number.isInteger(promotionId) ? promotionId : null);
  return r.ok ? { ok: true, data: r.deposit } : { ok: false, error: r.error };
}

/** Upload the transfer slip (a photo or screenshot). Images are checked by content, not by name. */
export async function uploadSlipAction(depositId: number, formData: FormData): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (!Number.isInteger(depositId)) return { ok: false, error: e.wallet.depositNotFound };
  const limit = limitLocal(`slip:${viewer.id}`, 6, 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.wallet.uploadBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const file = formData.get("slip");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: e.wallet.pickSlip };
  const saved = await saveImage(new Uint8Array(await file.arrayBuffer()), `slip-${viewer.id}`, { kind: "slip", ownerId: viewer.id });
  if (!saved.ok) return { ok: false, error: saved.error };
  const r = await attachSlip(viewer.id, depositId, saved.name);
  if (!r.ok) {
    await removeImage(saved.name);
    return { ok: false, error: r.error };
  }
  if (r.previous) await removeImage(r.previous);
  refresh();
  return { ok: true, message: e.wallet.slipAttached };
}

export async function confirmDepositAction(depositId: number): Promise<ActionResult<{ approved: boolean }>> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (!Number.isInteger(depositId)) return { ok: false, error: e.wallet.depositNotFound };
  const r = await confirmDeposit(viewer.id, depositId);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: { approved: r.approved } };
}

export async function cancelDepositAction(depositId: number): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (!Number.isInteger(depositId)) return { ok: false, error: e.wallet.depositNotFound };
  await cancelDeposit(viewer.id, depositId);
  refresh();
  return { ok: true };
}

export async function requestWithdrawalAction(amountBaht: number): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.memberOnly };
  const limit = limitLocal(`withdraw:${viewer.id}`, 5, 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.wallet.withdrawBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const amount = toSatang(amountBaht);
  if (Number.isNaN(amount)) return { ok: false, error: e.wallet.enterAmount };
  const r = await requestWithdrawal(viewer.id, amount);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: fmt(e.wallet.withdrawSent, { amount: formatBaht(amount) }) };
}

export async function claimCashbackAction(): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  const r = await claimCashback(viewer.id);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: fmt(e.wallet.cashbackClaimed, { amount: formatBaht(r.amount) }) };
}

export async function transferAffiliateAction(): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  const r = await transferAffiliate(viewer.id);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: fmt(e.wallet.affTransferred, { amount: formatBaht(r.amount) }) };
}

export async function redeemVoucherAction(code: string): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await member();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  // Coupon codes are guessable in principle: a handful of tries per member per 10 minutes.
  const limit = await limitShared(`voucher:${viewer.id}`, 8, 10 * 60_000);
  if (!limit.ok) return { ok: false, error: fmt(e.wallet.voucherBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const r = await redeemVoucher(viewer.id, String(code ?? "").slice(0, 30));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: fmt(e.wallet.voucherRedeemed, { amount: formatBaht(r.amount) }) };
}
