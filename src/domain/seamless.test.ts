import { describe, expect, test } from "vitest";
import {
  SC,
  adjustBalance,
  adjustBets,
  cancelBets,
  cancelTips,
  placeBets,
  placeTips,
  rollback,
  settleBets,
  toBaht,
  toSatang,
  voidSettled,
  winRewards,
  type GameTxn,
  type Snapshot,
} from "./seamless";

const snap = (balance: number, txns: GameTxn[] = []): Snapshot => ({ balance, txns: new Map(txns.map((t) => [t.txnId, t])) });
const open = (txnId: string, roundId: string, bet: number): GameTxn => ({
  txnId,
  roundId,
  gameCode: "g",
  playInfo: "p",
  status: "OPEN",
  kind: "bet",
  bet,
  debited: bet,
  payout: 0,
  credited: 0,
});
const bet = (id: string, betAmount: number, more: object = {}) => ({ id, roundId: "R1", gameCode: "g", playInfo: "p", status: "OPEN", betAmount, ...more });

describe("amounts on the wire are baht with decimals; the wallet keeps satang", () => {
  test("converts both ways without drift", () => {
    expect(toSatang(9997.5)).toBe(999_750);
    expect(toSatang(0.1 + 0.2)).toBe(30);
    expect(toBaht(999_750)).toBe(9997.5);
  });
});

describe("placing bets", () => {
  test("takes the stake, once", () => {
    const r = placeBets(snap(10_000_00), [bet("T1", 200_00)]);
    expect(r).toMatchObject({ code: SC.ok, balanceBefore: 10_000_00, balanceAfter: 9_800_00, wagered: 200_00 });
    expect(r.changes[0]).toMatchObject({ txnId: "T1", status: "OPEN", debited: 200_00 });
    expect(placeBets(snap(9_800_00, r.changes), [bet("T1", 200_00)]).code).toBe(SC.duplicate);
  });

  test("refuses a stake larger than the balance and changes nothing", () => {
    const r = placeBets(snap(100_00), [bet("T1", 60_00), bet("T2", 60_00)]);
    expect(r).toMatchObject({ code: SC.insufficient, changes: [], balanceAfter: 100_00 });
  });

  test("a sports bet the provider holds itself leaves the balance alone", () => {
    const r = placeBets(snap(100_00), [bet("S1", 500_00, { status: "WAITING", skipBalanceUpdate: true })]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 100_00, wagered: 0 });
    expect(r.changes[0]).toMatchObject({ status: "WAITING", debited: 0 });
  });
});

describe("settling", () => {
  test("pays the payout into the balance for one transaction", () => {
    const r = settleBets(snap(9_800_00, [open("T1", "R1", 200_00)]), [{ id: "T1", roundId: "R1", payoutAmount: 5000_00, transactionType: "BY_TRANSACTION" }]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 14_800_00 });
    expect(r.changes[0]).toMatchObject({ status: "SETTLED", credited: 5000_00 });
  });

  test("a round settled under a new id closes every open bet of the round and pays once", () => {
    const r = settleBets(snap(70_00, [open("A", "R9", 10_00), open("B", "R9", 20_00)]), [
      { id: "S", roundId: "R9", payoutAmount: 50_00, transactionType: "BY_ROUND" },
    ]);
    expect(r.balanceAfter).toBe(120_00);
    expect(r.changes.map((c) => [c.txnId, c.status, c.credited])).toEqual([
      ["A", "SETTLED", 0],
      ["B", "SETTLED", 0],
      ["S", "SETTLED", 50_00],
    ]);
  });

  test("settling twice is a duplicate, and settling a bet that never existed is refused", () => {
    const settled = { ...open("T1", "R1", 200_00), status: "SETTLED" as const, payout: 300_00, credited: 300_00 };
    expect(settleBets(snap(0, [settled]), [{ id: "T1", roundId: "R1", payoutAmount: 300_00 }]).code).toBe(SC.duplicate);
    expect(settleBets(snap(0), [{ id: "X", roundId: "R1", payoutAmount: 300_00 }]).code).toBe(SC.txnNotFound);
  });

  test("single-state games bet and settle in one call: stake out, payout in", () => {
    const r = settleBets(snap(100_00), [{ id: "P1", roundId: "R1", betAmount: 10_00, payoutAmount: 25_00, isSingleState: true }]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 115_00, wagered: 10_00 });
    expect(settleBets(snap(5_00), [{ id: "P2", roundId: "R1", betAmount: 10_00, payoutAmount: 0, isSingleState: true }]).code).toBe(SC.insufficient);
  });
});

describe("cancelling, adjusting, rolling back, voiding", () => {
  test("a cancelled bet gets back exactly what was taken, once", () => {
    const r = cancelBets(snap(800_00, [open("T1", "R1", 200_00)]), [{ id: "T1", roundId: "R1", status: "REFUND", betAmount: 999_00 }]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 1_000_00 });
    expect(cancelBets(snap(1_000_00, r.changes), [{ id: "T1", roundId: "R1", status: "REFUND" }]).code).toBe(SC.duplicate);
  });

  test("a settled bet cannot be cancelled", () => {
    const settled = { ...open("T1", "R1", 200_00), status: "SETTLED" as const };
    expect(cancelBets(snap(0, [settled]), [{ id: "T1", roundId: "R1", status: "REFUND" }]).code).toBe(SC.forbidden);
  });

  test("adjusting a bet charges or returns the difference", () => {
    expect(adjustBets(snap(9_990_00, [open("T1", "R1", 10_00)]), [{ id: "T1", roundId: "R1", betAmount: 20_00 }]).balanceAfter).toBe(9_980_00);
    expect(adjustBets(snap(9_990_00, [open("T1", "R1", 10_00)]), [{ id: "T1", roundId: "R1", betAmount: 4_00 }]).balanceAfter).toBe(9_996_00);
  });

  test("rolling back a settlement takes the payout back and reopens the bet", () => {
    const settled = { ...open("T1", "R1", 100_00), status: "SETTLED" as const, payout: 500_00, credited: 500_00 };
    const r = rollback(snap(1_400_00, [settled]), [{ id: "T1", roundId: "R1", transactionType: "BY_TRANSACTION" }]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 900_00 });
    expect(r.changes[0]).toMatchObject({ status: "OPEN", credited: 0 });
  });

  test("taking money back never goes below zero: the rest is recorded as owed", () => {
    const settled = { ...open("T1", "R1", 100_00), status: "SETTLED" as const, payout: 500_00, credited: 500_00 };
    const r = rollback(snap(200_00, [settled]), [{ id: "T1", roundId: "R1" }]);
    expect(r).toMatchObject({ code: SC.ok, balanceAfter: 0 });
    expect(r.moves[0]).toMatchObject({ amount: -200_00, shortfall: 300_00 });
  });

  test("voiding a settled bet refunds the stake and removes the payout", () => {
    const settled = { ...open("T1", "R1", 100_00), status: "SETTLED" as const, payout: 500_00, credited: 500_00 };
    expect(voidSettled(snap(1_400_00, [settled]), [{ id: "T1", roundId: "R1" }]).balanceAfter).toBe(1_000_00);
  });
});

describe("rewards, tips, and fishing-style balance moves", () => {
  test("a reward is paid once", () => {
    const r = winRewards(snap(8_600_00), [{ id: "W1", roundId: "R1", payoutAmount: 1_000_00 }]);
    expect(r.balanceAfter).toBe(9_600_00);
    expect(winRewards(snap(9_600_00, r.changes), [{ id: "W1", roundId: "R1", payoutAmount: 1_000_00 }]).code).toBe(SC.duplicate);
  });

  test("a tip is taken, and a cancelled tip comes back", () => {
    const r = placeTips(snap(10_000_00), [{ id: "Tip1", roundId: "TR", betAmount: 1_000_00 }]);
    expect(r.balanceAfter).toBe(9_000_00);
    expect(cancelTips(snap(9_000_00, r.changes), [{ id: "Tip1", roundId: "TR", betAmount: 1_000_00 }]).balanceAfter).toBe(10_000_00);
  });

  test("debit and credit by reference, each reference once", () => {
    const r = adjustBalance(snap(10_000_00), [{ refId: "ref-1", status: "DEBIT", amount: 1_500_00 }]);
    expect(r.balanceAfter).toBe(8_500_00);
    expect(adjustBalance(snap(8_500_00, r.changes), [{ refId: "ref-1", status: "DEBIT", amount: 1_500_00 }]).code).toBe(SC.duplicate);
    expect(adjustBalance(snap(100_00), [{ refId: "ref-2", status: "DEBIT", amount: 1_500_00 }]).code).toBe(SC.insufficient);
    expect(adjustBalance(snap(0), [{ refId: "ref-3", status: "CREDIT", amount: 70_00 }]).balanceAfter).toBe(70_00);
  });
});
