import "server-only";
import { outstandingDebt } from "@/core/wallet/debt";
import { pointsOf } from "@/server/services/points";
import { io } from "next/cache";
import { dayKey, dayStartMs } from "@/core/rules/time";
import { lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { json, q, q1, run } from "@/server/db";
import { depositsForUser, type WithdrawalRow } from "@/server/services/finance";
import { getSetting, getSettings } from "@/server/services/settings";
import { receivingAccount } from "@/server/services/banks";
import { listLottos } from "@/server/services/lottos";

export interface TxRow {
  id: number;
  wallet: "balance" | "cashback" | "affiliate";
  type: string;
  amount: number;
  balance_after: number;
  ref: string | null;
  /** What the row was for, in the visitor's language: the lotto and draw for bets, wins, and refunds. */
  detail: string | null;
  created_at: number;
}

export type TxFilter = "all" | "money" | "bets" | "rewards";
const TX_SQL: Record<TxFilter, string> = {
  all: "",
  money: "AND type IN ('deposit','withdraw','withdraw_refund','bonus','voucher','adjust','debt_repay')",
  bets: "AND type IN ('bet','win','refund','win_correction')",
  rewards: "AND type IN ('cashback_claim','aff_transfer','bonus','voucher','game')",
};

export async function getTransactions(userId: number, filter: TxFilter = "all", limit = 100): Promise<TxRow[]> {
  const { lang, t } = await getI18n();
  await io();
  // Notes are stored in Thai when the row is written; bet rows get their label from the bill instead.
  const rows = await q<Omit<TxRow, "detail"> & { lotto_id: number | null; round_no: number | null; closes_at: number | null; planned_close: number | null }>(
    `SELECT t.id, t.wallet, t.type, t.amount, t.balance_after, t.ref, t.created_at, r.lotto_id, r.round_no, r.closes_at, r.planned_close
     FROM (SELECT * FROM transactions WHERE user_id = ? AND wallet = 'balance' ${TX_SQL[filter]} ORDER BY created_at DESC, id DESC LIMIT ?) t
     LEFT JOIN bills b ON b.code = t.ref AND t.type IN ('bet','win','refund','win_correction')
     LEFT JOIN rounds r ON r.id = b.round_id
     ORDER BY t.created_at DESC, t.id DESC`,
    userId,
    limit,
  );
  // Named from the catalog, which reads whatever columns `lottos` has.
  const lottos = new Map((await listLottos({ includeDisabled: true })).map((l) => [l.id, l]));
  return rows.map(({ lotto_id, round_no, closes_at, planned_close, ...row }) => {
    const lotto = lotto_id == null ? undefined : lottos.get(lotto_id);
    return {
      ...row,
      detail:
        lotto && closes_at != null
          ? `${lottoShort(lotto, lang, t)} ${roundName({ roundNo: round_no, closesAt: closes_at, plannedClose: planned_close }, lang, t)}`
          : null,
    };
  });
}

export async function getWalletOverview(userId: number) {
  await io();
  const [debt, withdrawals, deposits, recent, points, pointRule] = await Promise.all([
    outstandingDebt({ q, q1, run }, userId),
    q<WithdrawalRow>("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", userId),
    depositsForUser(userId, 5),
    getTransactions(userId, "all", 8),
    pointsOf(userId, 5),
    getSetting("points"),
  ]);
  return { debt, withdrawals, deposits, recent, points, pointRule };
}

export async function getDepositPage(userId: number) {
  const { lang } = await getI18n();
  await io();
  const now = Date.now();
  const { wallet: w } = await getSettings();
  const [promoRows, claimed, recent] = await Promise.all([
    q<{
      id: number;
      title: string;
      summary: string;
      bonus_percent: number;
      max_bonus: number;
      min_deposit: number;
      turnover_x: number;
      once_per_user: number;
      i18n: string | null;
    }>(
      "SELECT id, title, summary, bonus_percent, max_bonus, min_deposit, turnover_x, once_per_user, i18n FROM promotions WHERE active = 1 AND bonus_percent > 0 ORDER BY sort",
    ),
    q<{ promotion_id: number }>("SELECT DISTINCT promotion_id FROM promotion_claims WHERE user_id = ?", userId),
    depositsForUser(userId, 5),
  ]);
  const used = new Set(claimed.map((c) => c.promotion_id));
  const promos = promoRows.map((p) => {
    const tr = lang === "th" ? undefined : json.parse<Record<string, { title?: string; summary?: string }>>(p.i18n, {})[lang];
    return {
      id: p.id,
      title: tr?.title || p.title,
      summary: tr?.summary || p.summary,
      bonusPercent: p.bonus_percent,
      maxBonus: p.max_bonus,
      minDeposit: p.min_deposit,
      turnoverX: p.turnover_x,
      used: p.once_per_user === 1 && used.has(p.id),
    };
  });
  const active = recent.find((d) => d.status === "awaiting" && d.expiresAt > now) ?? null;
  const pending = recent.filter((d) => d.status === "pending");
  return {
    serverNow: now,
    min: w.depositMin,
    max: w.depositMax,
    pointRule: await getSetting("points"),
    autoApprove: w.depositAutoApprove,
    slipRequired: w.slipRequired && !w.depositAutoApprove,
    hasAccount: (await receivingAccount()) !== null,
    promos,
    active,
    pending,
  };
}

export async function getWithdrawPage(userId: number) {
  await io();
  const now = Date.now();
  const { wallet: w } = await getSettings();
  const [today, pending] = await Promise.all([
    q1<{ n: number }>("SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND created_at >= ? AND status != 'rejected'", userId, dayStartMs(dayKey(now))),
    q<WithdrawalRow>("SELECT * FROM withdrawals WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC", userId),
  ]);
  return { min: w.withdrawMin, max: w.withdrawMax, perDay: w.withdrawPerDay, today: today?.n ?? 0, pending };
}
