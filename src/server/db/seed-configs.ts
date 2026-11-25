import "server-only";
import { buildRoundConfig } from "chokprathan-core/rules/roundConfig";
import { invalidate } from "@/server/cache";
import { json, q, q1, run } from "@/server/db";
import { betConfigs, billLimits, listLottos } from "@/server/services/lottos";
import { getSettings } from "@/server/services/settings";

/**
 * For demo seeding and tests only: the back office owns round configs. Gives every scheduled round
 * without bills a single `standard` package built from the lottery's current settings.
 */
export async function giveRoundsConfig(now = Date.now()): Promise<void> {
  invalidate("lottos", "settings");
  await run("INSERT IGNORE INTO price_packages (code, name, sort, updated_at) VALUES ('standard', 'มาตรฐาน', 0, ?)", now);
  const packageId = (await q1<{ id: number }>("SELECT id FROM price_packages WHERE code = 'standard'"))!.id;
  const [lottos, settings] = await Promise.all([listLottos({ includeDisabled: true }), getSettings()]);
  const rounds = await q<{ id: number; lotto_id: number }>(
    "SELECT r.id, r.lotto_id FROM rounds r WHERE r.status = 'scheduled' AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.round_id = r.id)",
  );
  for (const round of rounds) {
    const lotto = lottos.find((l) => l.id === round.lotto_id);
    if (!lotto) continue;
    const configs = betConfigs(lotto, settings);
    const limits = billLimits(lotto, settings);
    const built = buildRoundConfig({
      format: lotto.format,
      maxPerBill: limits.maxPerBill,
      maxLines: limits.maxLines,
      betTypes: configs.map((c) => ({ code: c.code, enabled: true, minStake: c.minStake, maxPerNumber: c.maxPerNumber, risk: c.profile })),
      packages: [
        {
          id: packageId,
          code: "standard",
          name: "มาตรฐาน",
          sort: 0,
          rates: Object.fromEntries(configs.map((c) => [c.code, { rate100: c.rate100, discountBp: 0 }])),
          overrides: {},
        },
      ],
    });
    if (!built.ok) continue;
    await run(
      "INSERT INTO round_configs (round_id, version, config, created_at) VALUES (?, 1, ?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)",
      round.id,
      json.str(built.config),
      now,
    );
  }
}
