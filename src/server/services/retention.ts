import "server-only";
import { errorsT } from "@/i18n/server";
import { q, q1, run, tx } from "@/server/db";
import { refClickCount, writeRefClick } from "@/server/logs";
import { allTimeByUser } from "@/server/stats/store";
import { move } from "./wallet";

type Outcome = { ok: true; amount: number } | { ok: false; error: string };

const MIN_CLAIM = 100; // ฿1

async function sweep(userId: number, from: "cashback" | "affiliate", now: number): Promise<Outcome> {
  const col = from === "cashback" ? "cashback_balance" : "affiliate_balance";
  const type = from === "cashback" ? "cashback_claim" : "aff_transfer";
  const e = await errorsT();
  return tx(async (): Promise<Outcome> => {
    const row = await q1<{ v: number }>(`SELECT ${col} AS v FROM users WHERE id = ? FOR UPDATE`, userId);
    const amount = row?.v ?? 0;
    if (amount < MIN_CLAIM) return { ok: false, error: e.wallet.minClaim };
    await move(userId, from, -amount, type, { note: "โอนเข้ากระเป๋าหลัก", now });
    await move(userId, "balance", amount, type, {
      note: from === "cashback" ? "รับยอดเงินคืน" : "รับรายได้แนะนำเพื่อน",
      now,
    });
    return { ok: true, amount };
  });
}

export const claimCashback = (userId: number, now = Date.now()) => sweep(userId, "cashback", now);
export const transferAffiliate = (userId: number, now = Date.now()) => sweep(userId, "affiliate", now);

export async function redeemVoucher(userId: number, rawCode: string, now = Date.now()): Promise<Outcome> {
  const code = rawCode.trim().toUpperCase();
  const e = await errorsT();
  if (!/^[A-Z0-9]{4,20}$/.test(code)) return { ok: false, error: code ? e.wallet.voucherNotFound : e.wallet.voucherEnter };
  return tx(async (): Promise<Outcome> => {
    const v = await q1<{ id: number; value: number; max_uses: number; used: number; expires_at: number | null; active: number }>(
      "SELECT id, value, max_uses, used, expires_at, active FROM vouchers WHERE code = ? FOR UPDATE",
      code,
    );
    if (!v || !v.active) return { ok: false, error: e.wallet.voucherNotFound };
    if (v.expires_at !== null && v.expires_at < now) return { ok: false, error: e.wallet.voucherExpired };
    if (await q1("SELECT 1 FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?", v.id, userId)) {
      return { ok: false, error: e.wallet.voucherUsed };
    }
    if (v.used >= v.max_uses) return { ok: false, error: e.wallet.voucherFull };
    await run("INSERT INTO voucher_redemptions (voucher_id, user_id, created_at) VALUES (?, ?, ?)", v.id, userId, now);
    await run("UPDATE vouchers SET used = used + 1 WHERE id = ?", v.id);
    await move(userId, "balance", v.value, "voucher", { ref: code, note: `คูปอง ${code}`, now });
    return { ok: true, amount: v.value };
  });
}

/** Count a visit to a referral link. Returns the referrer's id when the code exists. */
export async function recordRefClick(code: string, now = Date.now()): Promise<number | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  const user = await q1<{ id: number }>("SELECT id FROM users WHERE ref_code = ? AND role = 'member'", clean);
  if (!user) return null;
  await writeRefClick(user.id, now);
  return user.id;
}

export async function affiliateSummary(userId: number) {
  const [clicks, r] = await Promise.all([refClickCount(userId), affiliateTotals(userId)]);
  return { clicks, ...r };
}

async function affiliateTotals(userId: number) {
  const base = (await q1<{ tier1: number; tier2: number; balance: number | null }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE upline1_id = ?) AS tier1,
            (SELECT COUNT(*) FROM users WHERE upline2_id = ?) AS tier2,
            (SELECT affiliate_balance FROM users WHERE id = ?) AS balance`,
    userId,
    userId,
    userId,
  ))!;
  // Summaries first (fast for big networks); MariaDB answers when they are not complete yet.
  const downline = await q<{ id: number; tier: 1 | 2 }>(
    "SELECT id, CASE WHEN upline1_id = ? THEN 1 ELSE 2 END AS tier FROM users WHERE upline1_id = ? OR upline2_id = ?",
    userId,
    userId,
    userId,
  );
  const stats = await allTimeByUser([userId, ...downline.map((x) => x.id)]);
  if (stats) {
    const turnover = (tier: 1 | 2) => downline.filter((x) => x.tier === tier).reduce((s, x) => s + (stats.get(x.id)?.settled ?? 0), 0);
    return { tier1: base.tier1, tier2: base.tier2, tier1Turnover: turnover(1), tier2Turnover: turnover(2), earned: stats.get(userId)?.affEarn ?? 0, balance: base.balance ?? 0 };
  }
  const r = (await q1<{ t1: number | null; t2: number | null; earned: number | null }>(
    `SELECT
       (SELECT SUM(b.total_stake) FROM bills b JOIN users u ON u.id = b.user_id WHERE u.upline1_id = ? AND b.status IN ('won','lost')) AS t1,
       (SELECT SUM(b.total_stake) FROM bills b JOIN users u ON u.id = b.user_id WHERE u.upline2_id = ? AND b.status IN ('won','lost')) AS t2,
       (SELECT SUM(amount) FROM transactions WHERE user_id = ? AND wallet = 'affiliate' AND type IN ('aff_earn','aff_correction')) AS earned`,
    userId,
    userId,
    userId,
  ))!;
  return { tier1: base.tier1, tier2: base.tier2, tier1Turnover: r.t1 ?? 0, tier2Turnover: r.t2 ?? 0, earned: r.earned ?? 0, balance: base.balance ?? 0 };
}

export async function downlines(userId: number, limit = 50) {
  const rows = await q<{ id: number; phone: string | null; name: string; created_at: number; tier: 1 | 2 }>(
    `SELECT u.id, u.phone, u.name, u.created_at, CASE WHEN u.upline1_id = ? THEN 1 ELSE 2 END AS tier
     FROM users u WHERE u.upline1_id = ? OR u.upline2_id = ?
     ORDER BY u.created_at DESC LIMIT ?`,
    userId,
    userId,
    userId,
    limit,
  );
  const stats = await allTimeByUser(rows.map((x) => x.id));
  if (stats) return rows.map((x) => ({ ...x, turnover: stats.get(x.id)?.settled ?? 0 }));
  const sums = rows.length
    ? await q<{ user_id: number; s: number | null }>("SELECT user_id, SUM(total_stake) AS s FROM bills WHERE user_id IN (?) AND status IN ('won','lost') GROUP BY user_id", rows.map((x) => x.id))
    : [];
  const by = new Map(sums.map((x) => [x.user_id, x.s ?? 0]));
  return rows.map((x) => ({ ...x, turnover: by.get(x.id) ?? 0 }));
}

export async function cashbackSummary(userId: number) {
  const r = (await q1<{ earned: number | null; claimed: number | null; balance: number | null }>(
    `SELECT
       (SELECT SUM(amount) FROM transactions WHERE user_id = ? AND wallet = 'cashback' AND type IN ('cashback_earn','cashback_correction')) AS earned,
       (SELECT SUM(amount) FROM transactions WHERE user_id = ? AND wallet = 'cashback' AND type = 'cashback_claim') AS claimed,
       (SELECT cashback_balance FROM users WHERE id = ?) AS balance`,
    userId,
    userId,
    userId,
  ))!;
  return { earned: r.earned ?? 0, claimed: -(r.claimed ?? 0), balance: r.balance ?? 0 };
}
