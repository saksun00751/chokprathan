import { beforeEach, describe, expect, test } from "vitest";
import { q, q1, run } from "@/server/db";
import { hasTestDb, resetDb } from "@/test/db";
import { approveDeposit, approveWithdrawal, attachSlip, confirmDeposit, createDeposit, rejectWithdrawal, requestWithdrawal } from "./finance";
import { claimCashback, redeemVoucher, transferAffiliate } from "./retention";
import { getSetting, setSetting } from "./settings";

const now = Date.UTC(2026, 10, 4, 5, 0);
let userId: number;
let depositAccount = 0;

async function wallets(id = userId) {
  return (await q1<{ balance: number; cashback_balance: number; affiliate_balance: number; turnover_required: number; first_deposit_at: number | null }>(
    "SELECT balance, cashback_balance, affiliate_balance, turnover_required, first_deposit_at FROM users WHERE id = ?",
    id,
  ))!;
}

describe.skipIf(!hasTestDb)("money on MariaDB", () => {
  beforeEach(async () => {
    await resetDb();
    userId = (
      await run(
        `INSERT INTO users (phone, password_hash, name, ref_code, bank_code, bank_account, bank_name, balance, created_at)
         VALUES ('0811111111', 'x', 'ทดสอบ', 'ABC123', 'kbank', '0123456789', 'ทดสอบ', 0, ?)`,
        now,
      )
    ).lastId;
    await setSetting("wallet", { ...(await getSetting("wallet")), depositAutoApprove: false, slipRequired: false });
    depositAccount = (
      await run("INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at) VALUES ('deposit', 'kbank', '1234567890', 'ทดสอบ', ?, ?)", now, now)
    ).lastId;
  });

  describe("deposits", () => {
    test("a deposit gets a unique satang tail and credits that exact amount on approval", async () => {
      const d = await createDeposit(userId, 50_000, null, now);
      if (!d.ok) throw new Error(d.error);
      expect(d.deposit.amount).toBeGreaterThan(50_000);
      expect(d.deposit.amount).toBeLessThan(50_100);
      expect((await confirmDeposit(userId, d.deposit.id, now + 1000)).ok).toBe(true);
      expect((await wallets()).balance).toBe(0);
      expect((await approveDeposit(d.deposit.id, null, now + 2000)).ok).toBe(true);
      expect((await wallets()).balance).toBe(d.deposit.amount);
      expect((await wallets()).first_deposit_at).toBe(now + 2000);
    });

    test("approving twice at the same moment credits once", async () => {
      const d = await createDeposit(userId, 50_000, null, now);
      if (!d.ok) throw new Error(d.error);
      await confirmDeposit(userId, d.deposit.id, now);
      const results = await Promise.all([approveDeposit(d.deposit.id, null, now), approveDeposit(d.deposit.id, null, now)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect((await wallets()).balance).toBe(d.deposit.amount);
      // The website account the member paid into is credited once, with one history row.
      expect((await q1<{ balance: number }>("SELECT balance FROM bank_accounts WHERE id = ?", depositAccount))!.balance).toBe(d.deposit.amount);
      expect(await q("SELECT kind, amount, ref FROM bank_account_moves WHERE account_id = ?", depositAccount)).toEqual([
        { kind: "deposit", amount: d.deposit.amount, ref: `DP${String(d.deposit.id).padStart(6, "0")}` },
      ]);
    });

    test("a promotion adds a capped bonus and a turnover requirement", async () => {
      const promo = (
        await run(
          `INSERT INTO promotions (title, summary, details, bonus_percent, max_bonus, min_deposit, turnover_x, created_at)
           VALUES ('ฝากแรก', 'รับ 20%', '', 20, 50000, 30000, 3, ?)`,
          now,
        )
      ).lastId;
      const d = await createDeposit(userId, 1_000_000, promo, now);
      if (!d.ok) throw new Error(d.error);
      await confirmDeposit(userId, d.deposit.id, now);
      await approveDeposit(d.deposit.id, null, now);
      const w = await wallets();
      expect(w.balance).toBe(d.deposit.amount + 50_000);
      expect(w.turnover_required).toBe((d.deposit.amount + 50_000) * 3);
    });

    test("auto-approve credits as soon as the member confirms the transfer", async () => {
      await setSetting("wallet", { ...(await getSetting("wallet")), depositAutoApprove: true });
      const d = await createDeposit(userId, 20_000, null, now);
      if (!d.ok) throw new Error(d.error);
      await confirmDeposit(userId, d.deposit.id, now);
      expect((await wallets()).balance).toBe(d.deposit.amount);
    });

    test("with slips required, confirming needs an attached slip", async () => {
      await setSetting("wallet", { ...(await getSetting("wallet")), slipRequired: true });
      const d = await createDeposit(userId, 20_000, null, now);
      if (!d.ok) throw new Error(d.error);
      expect(await confirmDeposit(userId, d.deposit.id, now)).toMatchObject({ ok: false });
      expect(await attachSlip(userId, d.deposit.id, "slip-abc.jpg")).toEqual({ ok: true, previous: null });
      expect((await confirmDeposit(userId, d.deposit.id, now)).ok).toBe(true);
    });

    test("amounts outside the limits are refused", async () => {
      expect((await createDeposit(userId, 5_000, null, now)).ok).toBe(false);
      expect((await createDeposit(userId, 100_000_01, null, now)).ok).toBe(false);
    });

    test("no active deposit account means no deposit", async () => {
      await run("UPDATE bank_accounts SET active = 0");
      expect(await createDeposit(userId, 20_000, null, now)).toMatchObject({ ok: false });
    });
  });

  describe("withdrawals", () => {
    test("holds the money on request and refunds it on rejection", async () => {
      await run("UPDATE users SET balance = 100000 WHERE id = ?", userId);
      const w = await requestWithdrawal(userId, 30_000, now);
      expect(w.ok).toBe(true);
      expect((await wallets()).balance).toBe(70_000);
      if (!w.ok) return;
      expect((await rejectWithdrawal(w.id, userId, "ข้อมูลไม่ตรง", now)).ok).toBe(true);
      expect((await wallets()).balance).toBe(100_000);
    });

    test("is blocked while a promotion turnover is outstanding", async () => {
      await run("UPDATE users SET balance = 100000, turnover_required = 5000 WHERE id = ?", userId);
      expect(await requestWithdrawal(userId, 30_000, now)).toMatchObject({ ok: false });
      expect((await wallets()).balance).toBe(100_000);
    });

    test("cannot exceed the balance, even with requests in parallel", async () => {
      await run("UPDATE users SET balance = 50000 WHERE id = ?", userId);
      const results = await Promise.all(Array.from({ length: 4 }, () => requestWithdrawal(userId, 20_000, now)));
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect((await wallets()).balance).toBe(10_000);
    });

    test("respects the daily count under parallel requests", async () => {
      await run("UPDATE users SET balance = 10000000 WHERE id = ?", userId);
      await setSetting("wallet", { ...(await getSetting("wallet")), withdrawPerDay: 2 });
      const results = await Promise.all(Array.from({ length: 4 }, () => requestWithdrawal(userId, 10_000, now)));
      expect(results.filter((r) => r.ok)).toHaveLength(2);
    });
  });

  describe("website withdraw accounts", () => {
    test("a payout needs the account it left from, and that account's balance goes down", async () => {
      const payout = (
        await run("INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at) VALUES ('withdraw', 'scb', '4058123456', 'จ่าย', ?, ?)", now, now)
      ).lastId;
      await run("UPDATE users SET balance = 100000 WHERE id = ?", userId);
      const w = await requestWithdrawal(userId, 30_000, now);
      if (!w.ok) throw new Error(w.error);
      expect((await approveWithdrawal(w.id, userId, now)).ok).toBe(false);
      expect((await approveWithdrawal(w.id, userId, now, null, payout)).ok).toBe(true);
      expect((await q1<{ balance: number }>("SELECT balance FROM bank_accounts WHERE id = ?", payout))!.balance).toBe(-30_000);
      expect((await q1<{ paid_from_id: number }>("SELECT paid_from_id FROM withdrawals WHERE id = ?", w.id))!.paid_from_id).toBe(payout);
    });
  });

  describe("rewards", () => {
    test("cashback and affiliate income move into the main balance", async () => {
      await run("UPDATE users SET cashback_balance = 1234, affiliate_balance = 5678 WHERE id = ?", userId);
      expect(await claimCashback(userId, now)).toEqual({ ok: true, amount: 1_234 });
      expect(await transferAffiliate(userId, now)).toEqual({ ok: true, amount: 5_678 });
      expect(await wallets()).toMatchObject({ balance: 6_912, cashback_balance: 0, affiliate_balance: 0 });
    });

    test("claiming an empty wallet is refused", async () => {
      expect((await claimCashback(userId, now)).ok).toBe(false);
    });

    test("a voucher redeems once per member and respects its usage limit, also in parallel", async () => {
      await run("INSERT INTO vouchers (code, value, max_uses, created_at) VALUES ('LUCKY50', 5000, 2, ?)", now);
      const twice = await Promise.all([redeemVoucher(userId, "lucky50", now), redeemVoucher(userId, "LUCKY50", now)]);
      expect(twice.filter((r) => r.ok)).toHaveLength(1);
      const others = await Promise.all(
        ["0822222222", "0833333333"].map(async (phone, i) => {
          const id = (await run("INSERT INTO users (phone, password_hash, ref_code, created_at) VALUES (?, 'x', ?, ?)", phone, `XYZ99${i}`, now)).lastId;
          return redeemVoucher(id, "LUCKY50", now);
        }),
      );
      expect(others.filter((r) => r.ok)).toHaveLength(1);
      expect((await wallets()).balance).toBe(5_000);
      expect(await q("SELECT 1 FROM voucher_redemptions")).toHaveLength(2);
    });
  });
});
