import { beforeEach, describe, expect, test } from "vitest";
import { q1, run } from "@/server/db";
import { hasTestDb, resetDb } from "@/test/db";

describe.skipIf(!hasTestDb)("lottery configuration tables", () => {
  beforeEach(resetDb);

  const lotto = async () =>
    (
      await run(
        "INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk) VALUES ('x', 'x', 'x', 'thai', 'standard', '{}', '{}', '{}', '{}')",
      )
    ).lastId;

  test("a round's config goes with the round", async () => {
    const round = (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, '2026-11-25', 1, 2, 3)", await lotto())).lastId;
    await run("INSERT INTO round_configs (round_id, version, config, created_at) VALUES (?, 1, '{}', 1)", round);
    await run("DELETE FROM rounds WHERE id = ?", round);
    expect((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM round_configs"))!.n).toBe(0);
  });

  test("a discount of 100% or a rate of zero is refused", async () => {
    const pkg = (await run("INSERT INTO price_packages (code, name, updated_at) VALUES ('p', 'p', 1)")).lastId;
    await expect(run("INSERT INTO package_rates (package_id, bet_type, rate100, discount_bp) VALUES (?, 'top3', 100, 10000)", pkg)).rejects.toThrow();
    await expect(run("INSERT INTO package_rates (package_id, bet_type, rate100, discount_bp) VALUES (?, 'top3', 0, 0)", pkg)).rejects.toThrow();
  });
});
