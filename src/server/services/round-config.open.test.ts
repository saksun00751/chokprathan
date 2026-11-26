import { beforeEach, describe, expect, test } from "vitest";
import { run } from "@/server/db";
import { giveRoundsConfig } from "@/server/db/seed-configs";
import { hasTestDb, resetDb } from "@/test/db";
import { openRoundConfigs, unpricedRound } from "./round-config";

const now = 10_000;

describe.skipIf(!hasTestDb)("open rounds and their prices", () => {
  let lotto: number;
  const round = async (opens: number, closes: number, status = "scheduled") =>
    (await run("INSERT INTO rounds (lotto_id, day_key, opens_at, closes_at, draw_at, status) VALUES (?, '1970-01-01', ?, ?, ?, ?)", lotto, opens, closes, closes + 1, status)).lastId;

  beforeEach(async () => {
    await resetDb();
    await run("DELETE FROM rounds");
    await run("DELETE FROM lottos");
    lotto = (await run("INSERT INTO lottos (slug, name, short_name, grp, format, schedule, rates, limits, risk) VALUES ('o', 'o', 'o', 'foreign', 'standard', '{}', '{}', '{}', '{}')")).lastId;
  });

  test("a round without a config is reported as not priced yet, not as missing", async () => {
    const id = await round(1, now + 1000);
    expect(await unpricedRound(id, now)).toMatchObject({ round: { id }, lotto: { id: lotto } });
    await giveRoundsConfig(now);
    expect(await unpricedRound(id, now)).toBeNull();
  });

  test("only a round that can still take bets is waiting for prices", async () => {
    expect(await unpricedRound(await round(1, now - 1), now)).toBeNull();
    expect(await unpricedRound(await round(1, now + 1000, "cancelled"), now)).toBeNull();
    expect(await unpricedRound(999_999, now)).toBeNull();
  });

  test("takes each lottery's prices from the open round that closes first", async () => {
    await round(1, now + 5000);
    const first = await round(1, now + 1000);
    await round(now + 100, now + 500); // not open yet
    await giveRoundsConfig(now);
    const open = await openRoundConfigs(now);
    expect([...open.keys()]).toEqual([lotto]);
    expect(open.get(lotto)!.round.id).toBe(first);
  });
});
