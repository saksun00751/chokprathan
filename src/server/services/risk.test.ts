import { beforeEach, describe, expect, test } from "vitest";
import { json, q1, run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { limitsForRounds } from "./risk";

describe.skipIf(!hasTestDb)("limit badges with several packages", () => {
  let roundId: number;
  beforeEach(async () => {
    await resetDb();
    const lotto = (
      await run(
        `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk)
         VALUES ('x', 'x', 'x', 'foreign', 'standard', '{}', '{}', '{}', '{}')`,
      )
    ).lastId;
    roundId = (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, '1970-01-01', 1, 5000, 6000)", lotto)).lastId;
    await giveRoundsConfig(1);
  });

  const manual = (betType: string, number: string, kind: string, percent: number | null) =>
    run("INSERT INTO manual_limits (round_id, bet_type, number, kind, percent, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, 1)", roundId, betType, number, kind, percent);

  test("carries the cut as a percent, so every package can apply it to its own rate", async () => {
    await manual("top2", "25", "percent", 75);
    await manual("top2", "26", "closed", null);
    const badges = (await limitsForRounds([roundId])).get(roundId)!;
    expect(badges.map((b) => [b.number, b.percent])).toEqual([
      ["25", 75],
      ["26", null],
    ]);
  });

  test("covers a bet type only another package offers", async () => {
    const config = JSON.parse((await q1<{ config: string }>("SELECT config FROM round_configs WHERE round_id = ?", roundId))!.config);
    const top3 = config.packages[0].rates.top3;
    delete config.packages[0].rates.top3;
    config.packages.push({ id: 999, code: "d", name: "d", rates: { top3 } });
    await run("UPDATE round_configs SET config = ? WHERE round_id = ?", json.str(config), roundId);
    await manual("top3", "123", "closed", null);
    const badges = (await limitsForRounds([roundId])).get(roundId)!;
    expect(badges.map((b) => [b.betType, b.number])).toEqual([["top3", "123"]]);
  });
});
