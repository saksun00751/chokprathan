import { beforeEach, describe, expect, test, vi } from "vitest";
import { json, q, q1, run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { cancelBill, placeBill } from "./bills";
import { approveDeposit, approveWithdrawal, rejectWithdrawal, requestWithdrawal } from "./finance";
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

  test("a game win is collected, and the provider is told the figures before collection", async () => {
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

  const game = (action: Parameters<typeof handleCallback>[0], txns: object[], at = now) =>
    handleCallback(action, { id: `req-${Math.random()}`, productId: "PGSOFT", currency: "THB", username: `cp${String(user).padStart(6, "0")}`, timestampMillis: at, txns }, at);
  const stake = (id: string, betAmount: number, at = now) => game("placeBets", [{ id, roundId: id, status: "OPEN", betAmount }], at);
  const win = (id: string, payoutAmount: number, at = now) => game("settleBets", [{ id, roundId: id, status: "SETTLED", payoutAmount, betAmount: 0, transactionType: "BY_TRANSACTION" }], at);
  const takeBack = (id: string, at = now) => game("rollback", [{ id, roundId: id, status: "OPEN", transactionType: "BY_TRANSACTION" }], at);

  test("a game win and its collection happen together or not at all", async () => {
    await run("UPDATE users SET balance = 20000 WHERE id = ?", user);
    await stake("T9", 200);
    await owe(10_000);
    // Make the repayment itself fail.
    await run("CREATE TRIGGER debt_repay_fails BEFORE INSERT ON transactions FOR EACH ROW BEGIN IF NEW.type = 'debt_repay' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'repayment failed'; END IF; END");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await win("T9", 500, now + 1)).statusCode).not.toBe(0);
    } finally {
      quiet.mockRestore();
      await run("DROP TRIGGER debt_repay_fails");
    }
    expect((await wallets()).balance).toBe(0);
    // The provider sends it again and this time both happen.
    expect((await win("T9", 500, now + 2)).statusCode).toBe(0);
    expect((await wallets()).balance).toBe(40_000);
    expect(await owed()).toBe(0);
  });

  test("a win taken back after it repaid a debt puts that debt back", async () => {
    await run("UPDATE users SET balance = 20000 WHERE id = ?", user);
    await stake("T1", 200);
    await owe(50_000);
    await win("T1", 500, now + 1);
    expect([await owed(), (await wallets()).balance]).toEqual([0, 0]);
    expect((await takeBack("T1", now + 2)).statusCode).toBe(0);
    expect([await owed(), (await wallets()).balance]).toEqual([50_000, 0]);
  });

  test("restores no more than the win had repaid", async () => {
    await run("UPDATE users SET balance = 20000 WHERE id = ?", user);
    await stake("T2", 200);
    await owe(20_000);
    await win("T2", 500, now + 1);
    await run("UPDATE users SET balance = 0 WHERE id = ?", user); // the rest is spent
    await takeBack("T2", now + 2);
    expect(await owed()).toBe(20_000);
  });

  test("restores nothing for a debt a deposit repaid", async () => {
    await run("UPDATE users SET balance = 20000 WHERE id = ?", user);
    await stake("T3", 200);
    await win("T3", 500, now + 1);
    await run("UPDATE users SET balance = 0 WHERE id = ?", user);
    await owe(30_000);
    await move(user, "balance", 30_000, "deposit", { now: now + 2 });
    await takeBack("T3", now + 3);
    expect(await owed()).toBe(0);
  });

  test("a deposit made while owing earns no bonus and adds no turnover", async () => {
    const promo = (await run("INSERT INTO promotions (title, summary, details, bonus_percent, turnover_x, once_per_user, created_at) VALUES ('p', 'p', 'p', 100, 3, 0, 1)")).lastId;
    const deposit = async () =>
      (await run("INSERT INTO deposits (user_id, amount, promotion_id, status, expires_at, created_at) VALUES (?, 50000, ?, 'pending', ?, ?)", user, promo, now + 10_000, now)).lastId;
    const after = () => q1("SELECT balance, turnover_required FROM users WHERE id = ?", user);

    await owe(100_000);
    expect((await approveDeposit(await deposit(), null, now)).ok).toBe(true);
    expect(await after()).toEqual({ balance: 0, turnover_required: 0 });
    expect(await owed()).toBe(50_000);
    expect(await q("SELECT 1 FROM promotion_claims")).toEqual([]);

    await run("UPDATE member_debts SET outstanding = 0 WHERE user_id = ?", user);
    expect((await approveDeposit(await deposit(), null, now + 1)).ok).toBe(true);
    expect(await after()).toEqual({ balance: 100_000, turnover_required: 300_000 });
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
