import { beforeEach, describe, expect, test } from "vitest";
import { json, q, q1, run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { cancelBill, placeBill } from "./bills";
import { approveWithdrawal, rejectWithdrawal, requestWithdrawal } from "./finance";
import { handleCallback } from "./games";
import { redeemVoucher } from "./retention";
import { settlePending } from "./settlement";
import { move } from "./wallet";

const now = Date.UTC(2026, 10, 4, 5, 0);

describe.skipIf(!hasTestDb)("money coming in repays a member's debt first", () => {
  let user: number;

  beforeEach(async () => {
    await resetDb();
    user = (
      await run(
        `INSERT INTO users (phone, password_hash, name, ref_code, bank_code, bank_account, bank_name, balance, created_at)
         VALUES ('0811111111', 'x', 'ทดสอบ', 'DEBT0001', 'kbank', '0123456789', 'ทดสอบ', 0, ?)`,
        now,
      )
    ).lastId;
  });

  const owe = (satang: number) => run("INSERT INTO member_debts (user_id, amount, outstanding, created_at) VALUES (?, ?, ?, ?)", user, satang, satang, now);
  const wallets = async () => (await q1<{ balance: number; cashback_balance: number }>("SELECT balance, cashback_balance FROM users WHERE id = ?", user))!;
  const owed = async () => Number((await q1<{ n: string | null }>("SELECT SUM(outstanding) AS n FROM member_debts WHERE user_id = ?", user))!.n ?? 0);

  test("a credit is taken up to the debt and both movements are in the ledger", async () => {
    await owe(74_900);
    expect(await move(user, "balance", 100_000, "deposit", { now })).toBe(25_100);
    expect((await wallets()).balance).toBe(25_100);
    expect(await owed()).toBe(0);
    expect(await q("SELECT type, amount, balance_after FROM transactions WHERE user_id = ? ORDER BY id", user)).toEqual([
      { type: "deposit", amount: 100_000, balance_after: 100_000 },
      { type: "debt_repay", amount: -74_900, balance_after: 25_100 },
    ]);
  });

  test("a deduction collects nothing", async () => {
    await run("UPDATE users SET balance = 1000 WHERE id = ?", user);
    await owe(500);
    expect(await move(user, "balance", -100, "adjust", { now })).toBe(900);
    expect(await owed()).toBe(500);
  });

  test("a voucher and an earned cashback are collected", async () => {
    await owe(100_000);
    await run("INSERT INTO vouchers (code, value, max_uses, created_at) VALUES ('GIFT1', 5000, 10, ?)", now);
    expect((await redeemVoucher(user, "GIFT1", now)).ok).toBe(true);
    await move(user, "cashback", 300, "cashback_earn", { now });
    expect(await wallets()).toEqual({ balance: 0, cashback_balance: 0 });
    expect(await owed()).toBe(100_000 - 5300);
  });

  test("settlement winnings and a cancelled bill's refund are collected", async () => {
    const lotto = (
      await run(
        `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk)
         VALUES ('d', 'd', 'd', 'foreign', 'standard', ?, '{}', '{}', '{}')`,
        json.str({ kind: "weekly", days: [1], close: "20:00" }),
      )
    ).lastId;
    const round = (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, '2026-11-04', 1, ?, ?)", lotto, now + 3_600_000, now + 3_700_000)).lastId;
    await giveRoundsConfig(now);
    await run("UPDATE users SET balance = 100000 WHERE id = ?", user);
    const first = await placeBill(user, round, [{ betType: "top2", number: "25", stake: 100 }], { now });
    const second = await placeBill(user, round, [{ betType: "top2", number: "11", stake: 100 }], { now });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await owe(2_000_000);
    await cancelBill(user, second.billId, now + 1000);
    // The 10,000 refunded went to the debt.
    expect(await owed()).toBe(1_990_000);
    expect((await wallets()).balance).toBe(80_000);
    await run("UPDATE rounds SET status = 'resulted', result = ? WHERE id = ?", json.str({ top3: "925", bottom2: "49" }), round);
    await settlePending(round, now + 4_000_000);
    expect((await wallets()).balance).toBe(80_000);
    expect(await owed()).toBe(1_990_000 - 950_000);
    expect(await q1("SELECT total_payout FROM bills WHERE id = ?", first.billId)).toEqual({ total_payout: 950_000 });
  });

  test("a game win is collected after the provider has its answer", async () => {
    await run("UPDATE users SET balance = 100000 WHERE id = ?", user);
    const call = (action: Parameters<typeof handleCallback>[0], txns: object[]) =>
      handleCallback(action, { id: `req-${Math.random()}`, productId: "PGSOFT", currency: "THB", username: `cp${String(user).padStart(6, "0")}`, timestampMillis: now, txns }, now);
    await call("placeBets", [{ id: "T1", roundId: "R1", status: "OPEN", betAmount: 200 }]);
    await owe(1_000_000);
    expect(await call("settleBets", [{ id: "T1", roundId: "R1", status: "SETTLED", payoutAmount: 500, betAmount: 0, transactionType: "BY_TRANSACTION" }])).toMatchObject({
      statusCode: 0,
      balanceBefore: 800,
      balanceAfter: 1300,
    });
    // Only the 500 baht just won is taken; the 800 already held stays.
    expect((await wallets()).balance).toBe(80_000);
    expect(await owed()).toBe(1_000_000 - 50_000);
  });

  test("withdrawals are refused while anything is owed", async () => {
    await run("UPDATE users SET balance = 1000000 WHERE id = ?", user);
    const pending = await requestWithdrawal(user, 50_000, now);
    if (!pending.ok) throw new Error(pending.error);
    await owe(100);
    expect((await requestWithdrawal(user, 50_000, now)).ok).toBe(false);
    expect((await approveWithdrawal(pending.id, 1, now)).ok).toBe(false);
    // Turning the old request down returns the money, which is collected from.
    expect((await rejectWithdrawal(pending.id, 1, "", now)).ok).toBe(true);
    expect(await owed()).toBe(0);
    expect((await wallets()).balance).toBe(1_000_000 - 100);
    expect((await requestWithdrawal(user, 50_000, now)).ok).toBe(true);
  });
});
