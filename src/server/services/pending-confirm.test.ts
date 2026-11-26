import { beforeEach, describe, expect, test } from "vitest";
import { q1, run } from "@/server/db";
import { hasTestDb, resetDb } from "@/test/db";
import { ensureRounds, setResult } from "./rounds";
import { settlePending } from "./settlement";
import { bkkMs } from "@/core/rules/time";

const now = bkkMs(2026, 11, 4, 12, 0);

describe.skipIf(!hasTestDb)("rounds waiting for a second person", () => {
  let lottoId: number;
  beforeEach(async () => {
    await resetDb();
    lottoId = (
      await run(
        `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk)
         VALUES ('p', 'p', 'p', 'foreign', 'standard', '{"kind":"weekly","days":[3],"close":"20:00"}', '{}', '{}', '{}')`,
      )
    ).lastId;
  });

  const pendingRound = async () => {
    const id = (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at, status) VALUES (?, '2026-11-04', 1, 2, 3, 'pending_confirm')", lottoId)).lastId;
    const user = (await run("INSERT INTO users (password_hash, ref_code, created_at) VALUES ('x', 'PEND0001', 1)")).lastId;
    await run("INSERT INTO bills (code, user_id, round_id, total_stake, created_at) VALUES ('CPPEND0001', ?, ?, 100, 1)", user, id);
    return { id, user };
  };

  test("settlement refuses it and refunds nothing", async () => {
    const { id, user } = await pendingRound();
    await expect(settlePending(id, now)).rejects.toThrow();
    expect(await q1("SELECT status FROM bills WHERE round_id = ?", id)).toEqual({ status: "pending" });
    expect(await q1("SELECT balance FROM users WHERE id = ?", user)).toEqual({ balance: 0 });
  });

  test("a result cannot be written over it", async () => {
    const { id } = await pendingRound();
    expect((await setResult(id, { top3: "123", bottom2: "45" }, null, now)).ok).toBe(false);
    expect(await q1("SELECT status FROM rounds WHERE id = ?", id)).toEqual({ status: "pending_confirm" });
  });

  test("a round closed early is not created again at its planned time", async () => {
    await ensureRounds(now, { daysBack: 0, daysAhead: 0 });
    const planned = bkkMs(2026, 11, 4, 20, 0);
    await run("UPDATE rounds SET planned_close = closes_at, closes_at = ? WHERE closes_at = ?", now, planned);
    expect(await ensureRounds(now, { daysBack: 0, daysAhead: 0 })).toBe(0);
  });
});
