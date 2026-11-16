import { beforeEach, describe, expect, test } from "vitest";
import { q1, run } from "@/server/db";
import { hasTestDb, resetDb } from "@/test/db";
import { closeGameDay, handleCallback } from "./games";

const now = Date.UTC(2026, 10, 9, 5, 0);

async function member(phone: string, balance: number) {
  return (
    await run(
      "INSERT INTO users (phone, password_hash, name, ref_code, balance, created_at) VALUES (?, 'x', 'ทดสอบ', ?, ?, ?)",
      phone,
      `R${phone.slice(-6)}`,
      balance,
      now,
    )
  ).lastId;
}
const username = (id: number) => `cp${String(id).padStart(6, "0")}`;
const balanceOf = async (id: number) => Number((await q1<{ balance: number }>("SELECT balance FROM users WHERE id = ?", id))!.balance);
const call = (action: Parameters<typeof handleCallback>[0], userId: number, txns: object[]) =>
  handleCallback(action, { id: `req-${Math.random()}`, productId: "PGSOFT", currency: "THB", username: username(userId), timestampMillis: now, txns }, now);

describe.skipIf(!hasTestDb)("game callbacks on MariaDB", () => {
  beforeEach(resetDb);

  test("a bet and its settlement move the member's balance once, however often they arrive", async () => {
    const id = await member("0811111111", 1_000_00);
    expect(await call("placeBets", id, [{ id: "T1", roundId: "R1", gameCode: "g", playInfo: "x", status: "OPEN", betAmount: 200 }])).toMatchObject({
      statusCode: 0,
      balanceBefore: 1000,
      balanceAfter: 800,
    });
    expect(await call("placeBets", id, [{ id: "T1", roundId: "R1", gameCode: "g", playInfo: "x", status: "OPEN", betAmount: 200 }])).toMatchObject({
      statusCode: 20002,
    });
    expect(
      await call("settleBets", id, [{ id: "T1", roundId: "R1", status: "SETTLED", payoutAmount: 350.5, betAmount: 0, transactionType: "BY_TRANSACTION" }]),
    ).toMatchObject({ statusCode: 0, balanceAfter: 1150.5 });
    expect(
      await call("settleBets", id, [{ id: "T1", roundId: "R1", status: "SETTLED", payoutAmount: 350.5, transactionType: "BY_TRANSACTION" }]),
    ).toMatchObject({ statusCode: 20002 });
    expect(await balanceOf(id)).toBe(1_150_50);
  });

  test("checkBalance answers in baht; unknown players are not found", async () => {
    const id = await member("0822222222", 12_345);
    expect(await handleCallback("checkBalance", { id: "x", productId: "PGSOFT", currency: "THB", username: username(id) }, now)).toMatchObject({
      statusCode: 0,
      balance: 123.45,
    });
    expect(await handleCallback("checkBalance", { id: "x", productId: "PGSOFT", currency: "THB", username: "cp999999" }, now)).toMatchObject({
      statusCode: 10001,
    });
  });

  test("one member's transaction ids never touch another member's", async () => {
    const a = await member("0833333333", 500_00);
    const b = await member("0844444444", 500_00);
    await call("placeBets", a, [{ id: "SAME", roundId: "R1", status: "OPEN", betAmount: 100 }]);
    expect(await call("placeBets", b, [{ id: "SAME", roundId: "R1", status: "OPEN", betAmount: 100 }])).toMatchObject({ statusCode: 20002 });
    expect(await call("cancelBets", b, [{ id: "SAME", roundId: "R1", status: "REFUND", betAmount: 100, transactionType: "BY_TRANSACTION" }])).toMatchObject({
      statusCode: 20001,
    });
    expect(await balanceOf(a)).toBe(400_00);
    expect(await balanceOf(b)).toBe(500_00);
  });

  test("a day's net game loss earns cashback once", async () => {
    const id = await member("0855555555", 1_000_00);
    await call("placeBets", id, [{ id: "T1", roundId: "R1", status: "OPEN", betAmount: 1000 }]);
    await call("settleBets", id, [{ id: "T1", roundId: "R1", status: "SETTLED", payoutAmount: 0, transactionType: "BY_TRANSACTION" }]);
    const day = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
    expect(await closeGameDay(day, now + 86_400_000)).toBe(1);
    expect(await closeGameDay(day, now + 86_400_000)).toBe(0);
    expect(Number((await q1<{ cashback_balance: number }>("SELECT cashback_balance FROM users WHERE id = ?", id))!.cashback_balance)).toBe(50_00);
  });
});
