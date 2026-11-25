import { beforeEach, describe, expect, test } from "vitest";
import { run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { getRoundConfig, latestRoundConfigs } from "./round-config";

describe.skipIf(!hasTestDb)("round configs (member side)", () => {
  let roundId: number;
  beforeEach(async () => {
    await resetDb();
    const lotto = (
      await run(
        `INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk)
         VALUES ('x', 'x', 'x', 'foreign', 'standard', '{}', '{"top3":80000}', '{}', '{}')`,
      )
    ).lastId;
    roundId = (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at) VALUES (?, '1970-01-01', 1, 5000, 6000)", lotto)).lastId;
  });

  test("is absent until one is stored, then the latest version wins", async () => {
    expect(await getRoundConfig(roundId)).toBeUndefined();
    await giveRoundsConfig(1);
    const first = (await getRoundConfig(roundId))!;
    expect(first.config.packages[0].rates.top3).toEqual({ rate100: 80000, discountBp: 0 });
    await run("INSERT INTO round_configs (round_id, version, config, created_at) VALUES (?, 2, ?, 1)", roundId, JSON.stringify({ ...first.config, maxLines: 7 }));
    expect((await getRoundConfig(roundId))!.version).toBe(2);
    expect((await latestRoundConfigs([roundId, 999])).get(roundId)!.maxLines).toBe(7);
  });
});
