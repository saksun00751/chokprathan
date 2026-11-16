import "server-only";
import { io } from "next/cache";
import { betTypesFor } from "@/domain/betTypes";
import type { BetTypeCode, RiskProfile } from "@/domain/types";
import { lottoName, lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { memo } from "@/server/cache";
import { q } from "@/server/db";
import { betConfigs, getLottoBySlug, listLottos } from "@/server/services/lottos";
import { toRound, type RoundRow } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";

export async function getYikiRecent(limit = 12) {
  const { lang, t } = await getI18n();
  await io();
  const rows = await memo("results:yiki", 10_000, () =>
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
  const rows = await memo(`results:history:${lotto.id}`, 15_000, () =>
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
  const [lottos, settings] = await Promise.all([listLottos(), getSettings()]);
  const rows = lottos.map((l) => ({
    slug: l.slug,
    name: lottoShort(l, t),
    group: l.group,
    flag: l.flag,
    rates: Object.fromEntries(betConfigs(l, settings).map((c) => [c.code, c.rate100])) as Partial<Record<BetTypeCode, number>>,
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
