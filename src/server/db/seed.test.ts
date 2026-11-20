import { beforeAll, describe, expect, test } from "vitest";
import { bkkMs } from "@/domain/time";
import { q, q1 } from "@/server/db";
import { checkLogin } from "@/server/services/auth";
import { roundLimits } from "@/server/services/risk";
import { hasTestDb, resetDb } from "@/test/db";
import { seedDemo, seedEssentials } from "./seed";

const now = bkkMs(2026, 11, 4, 16, 30);
const client = { ip: null, userAgent: null };

// Seeding several days of history takes minutes over a remote link, so this runs on request:
// TEST_SEED=1 npm test -- src/server/db/seed.test.ts
describe.skipIf(!hasTestDb || !process.env.TEST_SEED)("staging seed", () => {
  beforeAll(async () => {
    await resetDb();
    await seedEssentials({ mode: "staging", now });
    await seedDemo({ now, days: 3 });
  }, 900_000);

  test("the demo member can log in, and the seed creates no staff", async () => {
    expect(await checkLogin("0812345678", "demo1234", client, now)).toMatchObject({ ok: true, role: "member" });
    expect((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role <> 'member'"))!.n).toBe(0);
  });

  test("history is settled and the ledger matches every balance", async () => {
    const settled = (await q1<{ n: number }>("SELECT COUNT(*) AS n FROM bills WHERE status IN ('won','lost')"))!.n;
    expect(settled).toBeGreaterThan(40);
    const mismatched = await q(
      `SELECT u.id FROM users u
       WHERE u.balance != COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id AND t.wallet = 'balance'), 0)
                         + CASE WHEN u.is_simulated = 1 THEN 1000000000 ELSE 0 END
          OR u.cashback_balance != COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id AND t.wallet = 'cashback'), 0)
          OR u.affiliate_balance != COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id AND t.wallet = 'affiliate'), 0)`,
    );
    expect(mismatched).toEqual([]);
  });

  test("exposure equals the sum of pending stakes for every number", async () => {
    const drift = await q(
      `SELECT e.round_id FROM exposures e
       LEFT JOIN (SELECT round_id, bet_type, number, SUM(stake) s FROM bill_items WHERE status IN ('pending','won','lost') GROUP BY round_id, bet_type, number) i
         ON i.round_id = e.round_id AND i.bet_type = e.bet_type AND i.number = e.number
       WHERE e.total_stake != COALESCE(i.s, 0)`,
    );
    expect(drift).toEqual([]);
  });

  test("the demo member has money, open bills, a win, and referral income", async () => {
    const demo = (await q1<{ id: number; balance: number; affiliate_balance: number }>(
      "SELECT id, balance, affiliate_balance FROM users WHERE phone = '0812345678'",
    ))!;
    expect(demo.balance).toBeGreaterThan(100_000);
    expect((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM bills WHERE user_id = ? AND status = 'pending'", demo.id))!.n).toBeGreaterThan(0);
    expect((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM bills WHERE user_id = ? AND status = 'won'", demo.id))!.n).toBeGreaterThan(0);
    expect(demo.affiliate_balance).toBeGreaterThan(0);
  });

  test("open rounds already show automatic rate cuts", async () => {
    const open = await q<{ id: number }>("SELECT id FROM rounds WHERE status = 'scheduled' AND opens_at <= ? AND closes_at > ?", now, now);
    const cut = (await Promise.all(open.map((r) => roundLimits(r.id)))).flat();
    expect(cut.some((b) => b.rate100 === null)).toBe(true);
    expect(cut.some((b) => b.rate100 !== null && b.rate100 < b.baseRate100)).toBe(true);
  });
});
