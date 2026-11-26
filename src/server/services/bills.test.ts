import { beforeEach, describe, expect, test } from "vitest";
import { bkkMs } from "@/core/rules/time";
import { fmt } from "@/i18n/format";
import th from "@/i18n/locales/th";
import { json, q, q1, run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { cancelBill, placeBill, quoteBill, settleRound } from "./bills";
import { cancelRound, setResult } from "./rounds";

let now: number;
let lottoId: number;
let roundId: number;
const closesAt = bkkMs(2026, 11, 4, 18, 5);

async function makeUser(phone: string, balance: number, upline1: number | null = null, upline2: number | null = null) {
  return (
    await run(
      `INSERT INTO users (phone, password_hash, name, ref_code, balance, upline1_id, upline2_id, created_at)
       VALUES (?, 'x', 'ทดสอบ', ?, ?, ?, ?, ?)`,
      phone,
      `R${phone.slice(-6)}`,
      balance,
      upline1,
      upline2,
      now,
    )
  ).lastId;
}

async function balanceOf(userId: number) {
  return (await q1<{ balance: number; cashback_balance: number; affiliate_balance: number }>(
    "SELECT balance, cashback_balance, affiliate_balance FROM users WHERE id = ?",
    userId,
  ))!;
}

async function exposure(betType: string, number: string) {
  return (
    (await q1<{ total_stake: number }>(
      "SELECT total_stake FROM exposures WHERE round_id = ? AND bet_type = ? AND number = ?",
      roundId,
      betType,
      number,
    ))?.total_stake ?? 0
  );
}

describe.skipIf(!hasTestDb)("bills on MariaDB", () => {
  beforeEach(async () => {
    await resetDb();
    now = bkkMs(2026, 11, 4, 12, 0);
    lottoId = (
      await run(
        `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, result_delay_min, rates, limits, risk)
         VALUES ('hanoi', 'หวยฮานอยปกติ', 'ฮานอยปกติ', 'foreign', 'standard', ?, 25, '{}', '{}', '{}')`,
        json.str({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], close: "18:05" }),
      )
    ).lastId;
    roundId = (
      await run(
        `INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, '2026-11-04', ?, ?, ?)`,
        lottoId,
        bkkMs(2026, 11, 3, 18, 5),
        closesAt,
        closesAt + 25 * 60_000,
      )
    ).lastId;
    await giveRoundsConfig(now);
  });

  describe("placeBill", () => {
    test("deducts the stake, records exposure, and writes a ledger entry", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      expect(r.ok).toBe(true);
      expect((await balanceOf(m)).balance).toBe(990_000);
      expect(await exposure("top2", "25")).toBe(100);
      const tx = await q1<{ type: string; amount: number; balance_after: number }>(
        "SELECT type, amount, balance_after FROM transactions WHERE user_id = ?",
        m,
      );
      expect(tx).toEqual({ type: "bet", amount: -10_000, balance_after: 990_000 });
    });

    test("a stake that crosses a tier threshold is split into segments", async () => {
      const whale = await makeUser("0822222222", 100_000_000);
      const m = await makeUser("0811111111", 1_000_000);
      const whale2 = await makeUser("0833333333", 100_000_000);
      await placeBill(whale, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });
      await placeBill(whale2, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });
      expect(r.ok).toBe(true);
      const item = (await q1<{ segments: string; potential: number }>(
        "SELECT segments, potential FROM bill_items WHERE bill_id = ?",
        r.ok ? r.billId : -1,
      ))!;
      expect(JSON.parse(item.segments)).toEqual([
        { stake: 1000, rate100: 9500 },
        { stake: 1000, rate100: 7125 },
      ]);
      expect(item.potential).toBe(1000 * 9500 + 1000 * 7125);
      expect(await exposure("top2", "25")).toBe(6000);
    });

    test("refuses with rate_changed when the confirmed quote is stale, unless changes are accepted", async () => {
      const whale = await makeUser("0822222222", 100_000_000);
      const m = await makeUser("0811111111", 1_000_000);
      const whale2 = await makeUser("0833333333", 100_000_000);
      const whale3 = await makeUser("0844444444", 100_000_000);
      await placeBill(whale, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });
      await placeBill(whale2, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });
      const quote = await quoteBill(m, roundId, [{ betType: "top2", number: "25", stake: 1000 }], now);
      expect(quote.ok).toBe(true);
      await placeBill(whale3, roundId, [{ betType: "top2", number: "25", stake: 2000 }], { now });

      const stale = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 1000 }], { now, expected: quote.fingerprint });
      expect(stale).toMatchObject({ ok: false, error: "rate_changed" });
      expect((await balanceOf(m)).balance).toBe(1_000_000);

      const accepted = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 1000 }], {
        now,
        expected: quote.fingerprint,
        acceptChanges: true,
      });
      expect(accepted.ok).toBe(true);
    });

    test("rejects bills once the round has closed", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now: closesAt });
      expect(r).toMatchObject({ ok: false, error: "round_closed" });
      expect((await balanceOf(m)).balance).toBe(1_000_000);
    });

    test("rejects when the balance is too low and changes nothing", async () => {
      const m = await makeUser("0811111111", 5_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      expect(r).toMatchObject({ ok: false, error: "insufficient_balance" });
      expect((await balanceOf(m)).balance).toBe(5_000);
      expect(await exposure("top2", "25")).toBe(0);
    });

    test("rejects a stake above the per-number limit", async () => {
      const m = await makeUser("0811111111", 10_000_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 2001 }], { now });
      expect(r).toMatchObject({ ok: false, error: "invalid" });
      if (!r.ok && r.quote) expect(r.quote.lines[0]).toMatchObject({ ok: false, reason: "max" });
    });

    test("says how much more the member can still put on a number they already hold", async () => {
      const m = await makeUser("0811111111", 10_000_000);
      await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 1500 }], { now });
      const over = await quoteBill(m, roundId, [{ betType: "top2", number: "25", stake: 600 }], now);
      expect(over.lines[0]).toMatchObject({ reason: "max", remaining: 500, message: fmt(th.errors.bet.maxLeft, { n: "2,000", left: "500" }) });
      await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 500 }], { now });
      const full = await quoteBill(m, roundId, [{ betType: "top2", number: "25", stake: 1 }], now);
      expect(full.lines[0]).toMatchObject({ reason: "max", remaining: 0, message: fmt(th.errors.bet.maxReached, { n: "2,000" }) });
    });

    test("a lotto-level risk override caps a number and reports the remaining room", async () => {
      await run(
        "UPDATE lottos SET risk = ? WHERE id = ?",
        json.str({ top2: { enabled: true, tiers: [{ threshold: 100, percent: 50 }], cap: 300 } }),
        lottoId,
      );
      await giveRoundsConfig(now);
      const a = await makeUser("0822222222", 10_000_000);
      const b = await makeUser("0811111111", 10_000_000);
      await placeBill(a, roundId, [{ betType: "top2", number: "25", stake: 200 }], { now });
      const quote = await quoteBill(b, roundId, [{ betType: "top2", number: "25", stake: 200 }], now);
      expect(quote.lines[0]).toMatchObject({ ok: false, reason: "cap", remaining: 100 });
    });

    test("two lines for the same number in one bill accumulate exposure", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      await placeBill(
        m,
        roundId,
        [
          { betType: "top2", number: "25", stake: 100 },
          { betType: "top2", number: "25", stake: 50 },
        ],
        { now },
      );
      expect(await exposure("top2", "25")).toBe(150);
    });

    test("staff accounts cannot bet", async () => {
      const staff = (
        await run("INSERT INTO users (username, password_hash, name, role, ref_code, balance, created_at) VALUES ('ops', 'x', 'ops', 'staff', 'ST1', 1000000, ?)", now)
      ).lastId;
      const r = await placeBill(staff, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      expect(r).toMatchObject({ ok: false, error: "suspended" });
    });

    test("the per-number limit covers all of a member's bills on the round", async () => {
      const m = await makeUser("0811111111", 10_000_000);
      expect((await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 1500 }], { now })).ok).toBe(true);
      const over = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 600 }], { now });
      expect(over).toMatchObject({ ok: false, error: "invalid" });
      expect((await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 500 }], { now })).ok).toBe(true);
    });

    test("a repeated request returns the first bill and charges once, even after closing", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const send = (at: number) => placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now: at, requestId: "req-00000001" });
      const [a, b] = await Promise.all([send(now), send(now)]);
      const late = await send(closesAt + 1);
      expect(a.ok && b.ok && late.ok).toBe(true);
      expect(new Set([a, b, late].map((r) => (r.ok ? r.billId : 0))).size).toBe(1);
      expect((await balanceOf(m)).balance).toBe(990_000);
      expect(await exposure("top2", "25")).toBe(100);
    });

    test("a discounted package charges less, pays winnings on the full stake, and refunds what was paid", async () => {
      const row = (await q1<{ config: string }>("SELECT config FROM round_configs WHERE round_id = ?", roundId))!;
      const config = JSON.parse(row.config);
      config.packages.push({ id: 999, code: "d", name: "d", rates: { top2: { rate100: 7500, discountBp: 1500 } } });
      await run("UPDATE round_configs SET config = ? WHERE round_id = ?", json.str(config), roundId);
      const m = await makeUser("0811111111", 1_000_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now, packageId: 999 });
      expect(r).toMatchObject({ ok: true, paid: 8500, balance: 991_500 });
      expect(await q1("SELECT total_stake, discount, package_id FROM bills WHERE user_id = ?", m)).toEqual({ total_stake: 8500, discount: 1500, package_id: 999 });
      expect(await q1("SELECT stake, discount, potential FROM bill_items WHERE round_id = ?", roundId)).toEqual({ stake: 100, discount: 1500, potential: 750_000 });
      expect(await cancelBill(m, r.ok ? r.billId : 0, now + 1000)).toEqual({ ok: true });
      expect((await balanceOf(m)).balance).toBe(1_000_000);
    });

    test("an unknown package is refused, by the quote and by placing", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const lines = [{ betType: "top2" as const, number: "25", stake: 100 }];
      expect(await quoteBill(m, roundId, lines, now, 12345)).toMatchObject({ ok: false, error: "bad_package", lines: [] });
      expect(await placeBill(m, roundId, lines, { now, packageId: 12345 })).toMatchObject({ ok: false, error: "invalid" });
      expect((await balanceOf(m)).balance).toBe(1_000_000);
    });

    test("changing the lottery after a bill does not move the round's prices", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 10 }], { now });
      await run("UPDATE lottos SET rates = ? WHERE id = ?", json.str({ top2: 100 }), lottoId);
      await giveRoundsConfig(now);
      const quote = await quoteBill(m, roundId, [{ betType: "top2", number: "31", stake: 10 }], now);
      expect(quote.lines[0]).toMatchObject({ ok: true, rate100: 9500 });
    });

    test("a round without a config takes no bet", async () => {
      await run("DELETE FROM round_configs");
      const m = await makeUser("0811111111", 1_000_000);
      const r = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 10 }], { now });
      expect(r).toMatchObject({ ok: false, error: "round_closed" });
      expect((await balanceOf(m)).balance).toBe(1_000_000);
    });
  });

  describe("concurrency", () => {
    test("parallel bills on one number never pass the cap", async () => {
      await run(
        "UPDATE lottos SET risk = ? WHERE id = ?",
        json.str({ top2: { enabled: true, tiers: [{ threshold: 300, percent: 50 }], cap: 1000 } }),
        lottoId,
      );
      await giveRoundsConfig(now);
      const users = await Promise.all(Array.from({ length: 8 }, (_, i) => makeUser(`08100000${String(i).padStart(2, "0")}`, 10_000_000)));
      const results = await Promise.all(users.map((u) => placeBill(u, roundId, [{ betType: "top2", number: "77", stake: 200 }], { now, acceptChanges: true })));
      const placed = results.filter((r) => r.ok).length;
      expect(placed).toBe(5); // 5 x 200 = the 1,000 cap
      expect(await exposure("top2", "77")).toBe(1000);
      const items = await q<{ segments: string }>("SELECT segments FROM bill_items WHERE round_id = ? ORDER BY id", roundId);
      const paidAtBase = items.flatMap((i) => JSON.parse(i.segments) as { stake: number; rate100: number }[]).filter((s) => s.rate100 === 9500);
      // Only the first 300 baht across all bills is priced at the full rate, whatever the interleaving.
      expect(paidAtBase.reduce((s, x) => s + x.stake, 0)).toBe(300);
    });

    test("parallel bills from one member cannot spend more than the balance", async () => {
      const m = await makeUser("0811111111", 50_000); // ฿500
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => placeBill(m, roundId, [{ betType: "top2", number: String(10 + i), stake: 100 }], { now })),
      );
      expect(results.filter((r) => r.ok).length).toBe(5);
      expect((await balanceOf(m)).balance).toBe(0);
      const ledger = await q<{ balance_after: number }>("SELECT balance_after FROM transactions WHERE user_id = ? ORDER BY id", m);
      expect(ledger.map((l) => l.balance_after)).toEqual([40_000, 30_000, 20_000, 10_000, 0]);
    });
  });

  describe("settlement", () => {
    test("pays winners exactly, credits cashback and affiliate tiers, and is idempotent", async () => {
      const u2 = await makeUser("0833333333", 0);
      const u1 = await makeUser("0844444444", 0, u2);
      const m = await makeUser("0811111111", 1_000_000, u1, u2);
      const placed = await placeBill(
        m,
        roundId,
        [
          { betType: "top2", number: "25", stake: 100 },
          { betType: "bottom2", number: "11", stake: 100 },
          { betType: "top3", number: "925", stake: 10 },
        ],
        { now },
      );
      expect(placed.ok).toBe(true);

      const r = await setResult(roundId, { top3: "925", bottom2: "49" }, null, closesAt + 60_000);
      expect(r.ok).toBe(true);

      expect(await balanceOf(m)).toEqual({
        balance: 1_000_000 - 21_000 + 100 * 9500 + 10 * 95000,
        cashback_balance: 500,
        affiliate_balance: 0,
      });
      expect((await balanceOf(u1)).affiliate_balance).toBe(168);
      expect((await balanceOf(u2)).affiliate_balance).toBe(42);
      const bill = await q1<{ status: string; total_payout: number }>("SELECT status, total_payout FROM bills WHERE user_id = ?", m);
      expect(bill).toEqual({ status: "won", total_payout: 1_900_000 });

      await settleRound(roundId, closesAt + 120_000);
      expect((await balanceOf(m)).balance).toBe(1_000_000 - 21_000 + 1_900_000);
      expect((await q1<{ settled_at: number | null }>("SELECT settled_at FROM rounds WHERE id = ?", roundId))?.settled_at).toBe(closesAt + 60_000);
    });

    test("settles in several chunks with an exact running ledger per member", async () => {
      // SETTLE_CHUNK=3 in tests, so 7 bills take three transactions.
      const m = await makeUser("0811111111", 1_000_000);
      for (let i = 0; i < 7; i++) {
        const r = await placeBill(m, roundId, [{ betType: "top2", number: i % 2 ? "25" : "11", stake: 10 }], { now });
        expect(r.ok).toBe(true);
      }
      await setResult(roundId, { top3: "925", bottom2: "49" }, null, closesAt + 60_000);
      const bills = await q<{ status: string }>("SELECT status FROM bills WHERE round_id = ? ORDER BY id", roundId);
      expect(bills.map((b) => b.status)).toEqual(["lost", "won", "lost", "won", "lost", "won", "lost"]);
      const wins = await q<{ amount: number; balance_after: number }>("SELECT amount, balance_after FROM transactions WHERE user_id = ? AND type = 'win' ORDER BY id", m);
      const start = 1_000_000 - 7 * 1000;
      expect(wins).toEqual([
        { amount: 95_000, balance_after: start + 95_000 },
        { amount: 95_000, balance_after: start + 190_000 },
        { amount: 95_000, balance_after: start + 285_000 },
      ]);
      expect((await balanceOf(m)).balance).toBe(start + 285_000);
      expect((await balanceOf(m)).cashback_balance).toBe(4 * 50);
    });

    test("result entry is refused before the round closes and for malformed digits", async () => {
      expect((await setResult(roundId, { top3: "925", bottom2: "49" }, null, closesAt - 1)).ok).toBe(false);
      expect((await setResult(roundId, { top3: "92", bottom2: "49" }, null, closesAt + 1)).ok).toBe(false);
    });

    test("a second result for the same round is refused and pays nothing twice", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 10 }], { now });
      const [a, b] = await Promise.all([
        setResult(roundId, { top3: "925", bottom2: "49" }, null, closesAt + 60_000),
        setResult(roundId, { top3: "925", bottom2: "49" }, null, closesAt + 60_000),
      ]);
      expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
      expect(await q("SELECT 1 FROM transactions WHERE user_id = ? AND type = 'win'", m)).toHaveLength(1);
    });

    test("cancelling a round refunds every pending bill once", async () => {
      const a = await makeUser("0811111111", 1_000_000);
      const b = await makeUser("0822222222", 1_000_000);
      await placeBill(a, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      await placeBill(b, roundId, [{ betType: "bottom2", number: "11", stake: 50 }], { now });
      await placeBill(a, roundId, [{ betType: "top3", number: "123", stake: 10 }], { now });
      const r = await cancelRound(roundId, null, now + 1000);
      expect(r).toEqual({ ok: true, refunded: 3 });
      expect((await balanceOf(a)).balance).toBe(1_000_000);
      expect((await balanceOf(b)).balance).toBe(1_000_000);
      expect((await cancelRound(roundId, null, now + 2000)).ok).toBe(false);
      expect(await q1("SELECT 1 FROM exposures WHERE round_id = ?", roundId)).toBeUndefined();
    });
  });

  describe("cancelBill", () => {
    test("refunds the stake and releases exposure inside the cancel window", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const placed = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      if (!placed.ok) throw new Error("setup failed");
      expect(await cancelBill(m, placed.billId, now + 60_000)).toEqual({ ok: true });
      expect((await balanceOf(m)).balance).toBe(1_000_000);
      expect(await exposure("top2", "25")).toBe(0);
      expect((await q1<{ status: string }>("SELECT status FROM bills WHERE id = ?", placed.billId))?.status).toBe("cancelled");
    });

    test("is refused after the window and after the round closes", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const placed = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      if (!placed.ok) throw new Error("setup failed");
      expect(await cancelBill(m, placed.billId, now + 16 * 60_000)).toEqual({ ok: false, error: "window_passed" });
      expect(await cancelBill(m, placed.billId, closesAt)).toEqual({ ok: false, error: "round_closed" });
    });

    test("cannot cancel someone else's bill", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const other = await makeUser("0899999999", 1_000_000);
      const placed = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      if (!placed.ok) throw new Error("setup failed");
      expect(await cancelBill(other, placed.billId, now + 60_000)).toEqual({ ok: false, error: "not_found" });
    });

    test("a bet and a cancel racing on the same member and number both finish", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const placed = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now });
      if (!placed.ok) throw new Error("setup failed");
      const [c, p] = await Promise.all([
        cancelBill(m, placed.billId, now + 1000),
        placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 70 }], { now: now + 1000 }),
      ]);
      expect(c).toEqual({ ok: true });
      expect(p.ok).toBe(true);
      expect(await exposure("top2", "25")).toBe(70);
      expect((await balanceOf(m)).balance).toBe(1_000_000 - 7_000);
    });

    test("is refused in the last minutes before closing", async () => {
      const m = await makeUser("0811111111", 1_000_000);
      const at = closesAt - 6 * 60_000;
      const placed = await placeBill(m, roundId, [{ betType: "top2", number: "25", stake: 100 }], { now: at });
      if (!placed.ok) throw new Error("setup failed");
      expect(await cancelBill(m, placed.billId, closesAt - 4 * 60_000)).toEqual({ ok: false, error: "window_passed" });
      expect(await cancelBill(m, placed.billId, closesAt - 5 * 60_000)).toEqual({ ok: true });
    });
  });
});
