import "server-only";
import { io } from "next/cache";
import { betTypesFor } from "chokprathan-core/rules/betTypes";
import type { BetTypeCode, RiskProfile } from "chokprathan-core/rules/types";
import { advertisedRates, packageRows, STANDARD_PACKAGE } from "@/domain/bet-packages";
import { lottoName, lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { memo } from "@/server/cache";
import { RESULTS_HISTORY_TTL_MS, RESULTS_TTL_MS } from "@/server/cache-ttl";
import { q } from "@/server/db";
import { betConfigs, getLottoBySlug, listLottos } from "@/server/services/lottos";
import { openRoundConfigs } from "@/server/services/round-config";
import { toRound, type RoundRow } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";

export async function getYikiRecent(limit = 12) {
  const { lang, t } = await getI18n();
  await io();
  const rows = await memo("results:yiki", RESULTS_TTL_MS, () =>
    q<RoundRow>(
      `SELECT r.* FROM rounds r JOIN lottos l ON l.id = r.lotto_id
       WHERE l.slug = 'yiki' AND r.status = 'resulted' ORDER BY r.closes_at DESC LIMIT 40`,
    ),
  );
  return rows.slice(0, limit).map((row) => {
    const r = toRound(row);
    return { id: r.id, label: roundName(r, lang, t), closesAt: r.closesAt, result: r.result! };
  });
}

export async function getLottoHistory(slug: string, limit = 30) {
  const { lang, t } = await getI18n();
  await io();
  const lotto = await getLottoBySlug(slug);
  if (!lotto || !lotto.enabled) return null;
  const rows = await memo(`results:history:${lotto.id}`, RESULTS_HISTORY_TTL_MS, () =>
    q<RoundRow>("SELECT * FROM rounds WHERE lotto_id = ? AND status = 'resulted' ORDER BY closes_at DESC LIMIT 60", lotto.id),
  );
  const rounds = rows.slice(0, limit).map((row) => {
    const r = toRound(row);
    return { id: r.id, label: roundName(r, lang, t), closesAt: r.closesAt, result: r.result! };
  });
  return { lotto: { slug: lotto.slug, name: lottoName(lotto, t), flag: lotto.flag, format: lotto.format, group: lotto.group }, rounds };
}

export async function getRateTables() {
  const { t } = await getI18n();
  await io();
  const [lottos, settings, open] = await Promise.all([listLottos(), getSettings(), openRoundConfigs(Date.now())]);
  const rows = lottos.map((l) => ({
    slug: l.slug,
    name: lottoShort(l, t),
    group: l.group,
    flag: l.flag,
    rates: Object.fromEntries(advertisedRates(open.get(l.id)?.config, betConfigs(l, settings)).map((c) => [c.code, c.rate100])) as Partial<Record<BetTypeCode, number>>,
  }));
  const codes = (["top4", "top3", "tod3", "front3", "bottom3", "top2", "bottom2", "runTop", "runBottom"] as BetTypeCode[]).filter((c) =>
    lottos.some((l) => betTypesFor(l.format).includes(c)),
  );
  const tiers = codes.map((code) => ({
    code,
    label: t.lotto.betTypes[code].label,
    profile: settings.risk[code] as RiskProfile,
    maxPerNumber: settings.limits.maxPerNumber[code],
  }));
  return { rows, codes, tiers, limits: { minStake: settings.limits.minStake, maxPerBill: settings.limits.maxPerBill } };
}

/** Discount packages of the round each lottery is taking bets on now. The standard one is in `getRateTables`. */
export async function getOpenPackages() {
  const { lang, t } = await getI18n();
  await io();
  const [lottos, open] = await Promise.all([listLottos(), openRoundConfigs(Date.now())]);
  return lottos.flatMap((lotto) => {
    const on = open.get(lotto.id);
    const packages = on ? packageRows(on.config).filter((p) => p.code !== STANDARD_PACKAGE) : [];
    if (!on || packages.length === 0) return [];
    return [{ slug: lotto.slug, name: lottoShort(lotto, t), flag: lotto.flag, round: roundName(on.round, lang, t), packages }];
  });
}
