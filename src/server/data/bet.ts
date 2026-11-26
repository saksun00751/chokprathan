import "server-only";
import { io } from "next/cache";
import { betRules } from "chokprathan-core/rules/quote";
import { rebetPlan, STANDARD_PACKAGE } from "@/domain/bet-packages";
import type { BetTypeCode, LottoGroup, ResultFormat } from "chokprathan-core/rules/types";
import { lottoName, lottoShort, roundName, scheduledClose } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { json, q, q1 } from "@/server/db";
import type { SessionUser } from "@/server/services/auth";
import { getLotto } from "@/server/services/lottos";
import { getRoundConfig, unpricedRound } from "@/server/services/round-config";
import { roundLimits, type LimitBadge } from "@/server/services/risk";
import { getRound, phaseOf, toRound, type RoundPhase, type RoundRow } from "@/server/services/rounds";

export interface BetConfigView {
  code: BetTypeCode;
  label: string;
  short: string;
  digits: number;
  rate100: number;
  discountBp: number;
  maxPerNumber: number;
  minStake: number;
}

export interface BetPackageView {
  id: number;
  standard: boolean;
  /** The name staff gave it; the standard package is named in the member's language instead. */
  name: string;
  configs: BetConfigView[];
}

export interface SavedSet {
  id: number;
  name: string;
  items: { betType: BetTypeCode; number: string; stake: number }[];
}

export interface BetPageData {
  serverNow: number;
  round: { id: number; label: string; /** the date that names the draw */ scheduledCloseAt: number; opensAt: number; closesAt: number; drawAt: number; phase: RoundPhase };
  lotto: { id: number; slug: string; name: string; shortName: string; flag: string | null; format: ResultFormat; group: LottoGroup };
  /** Never empty; the first one is preselected. */
  packages: BetPackageView[];
  limits: { minStake: number; maxPerBill: number; maxLines: number };
  badges: LimitBadge[];
  sets: SavedSet[];
  siblings: { id: number; label: string; closesAt: number }[];
  balance: number;
  initialLines: { betType: BetTypeCode; number: string; stake: number }[];
  initialPackageId: number;
  /** Set when betting a bill again could not carry everything over. */
  rebetNotice: { dropped: number; packageGone: boolean } | null;
}

export async function getBetPage(roundId: number, viewer: SessionUser, rebetBillId?: number): Promise<BetPageData | null> {
  const { lang, t } = await getI18n();
  await io();
  const now = Date.now();
  const round = await getRound(roundId);
  if (!round) return null;
  const lotto = await getLotto(round.lottoId);
  if (!lotto || !lotto.enabled) return null;

  const [stored, siblingRows, setRows, badges, rebet] = await Promise.all([
    getRoundConfig(round.id),
    q<RoundRow>(
      `SELECT * FROM rounds WHERE lotto_id = ? AND status = 'scheduled' AND opens_at <= ? AND closes_at > ?
       ORDER BY closes_at LIMIT 8`,
      lotto.id,
      now,
      now,
    ),
    q<{ id: number; name: string; items: string }>("SELECT id, name, items FROM number_sets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", viewer.id),
    roundLimits(round.id),
    rebetBillId
      ? q1<{ id: number; package_id: number | null }>("SELECT id, package_id FROM bills WHERE id = ? AND user_id = ?", rebetBillId, viewer.id).then(async (bill) =>
          bill
            ? {
                packageId: bill.package_id,
                items: await q<{ bet_type: BetTypeCode; number: string; stake: number }>("SELECT bet_type, number, stake FROM bill_items WHERE bill_id = ? ORDER BY id", bill.id),
              }
            : null,
        )
      : Promise.resolve(null),
  ]);

  // The back office stores prices with each round; without them there is nothing to bet on yet.
  if (!stored) return null;
  const packages = stored.config.packages.map((p) => ({
    id: p.id,
    standard: p.code === STANDARD_PACKAGE,
    name: p.name,
    configs: betRules(stored.config, p.id).map(({ code, digits, rate100, discountBp, maxPerNumber, minStake }) => ({
      code,
      label: t.lotto.betTypes[code].label,
      short: t.lotto.betTypes[code].short,
      digits,
      rate100,
      discountBp,
      maxPerNumber,
      minStake,
    })),
  }));

  const plan = rebetPlan(
    packages.map((p) => ({ id: p.id, types: new Set(p.configs.map((c) => c.code)) })),
    rebet?.packageId ?? null,
    (rebet?.items ?? []).map((i) => ({ betType: i.bet_type, number: i.number, stake: i.stake })),
  );

  return {
    serverNow: now,
    round: { id: round.id, label: roundName(round, lang, t), scheduledCloseAt: scheduledClose(round), opensAt: round.opensAt, closesAt: round.closesAt, drawAt: round.drawAt, phase: phaseOf(round, now) },
    lotto: { id: lotto.id, slug: lotto.slug, name: lottoName(lotto, t), shortName: lottoShort(lotto, t), flag: lotto.flag, format: lotto.format, group: lotto.group },
    packages,
    limits: { minStake: Math.min(...packages.flatMap((p) => p.configs.map((c) => c.minStake))), maxPerBill: stored.config.maxPerBill, maxLines: stored.config.maxLines },
    badges,
    sets: setRows.map((s) => ({ id: s.id, name: s.name, items: json.parse<SavedSet["items"]>(s.items, []) })),
    siblings: siblingRows.map((r) => {
      const x = toRound(r);
      return { id: x.id, label: roundName(x, lang, t), closesAt: x.closesAt };
    }),
    balance: viewer.balance,
    initialLines: plan.lines,
    initialPackageId: plan.packageId,
    rebetNotice: plan.dropped || plan.packageGone ? { dropped: plan.dropped, packageGone: plan.packageGone } : null,
  };
}

/** The names to show for a round that is on the list but has no prices yet. */
export async function getUnpricedBetRound(roundId: number) {
  const { lang, t } = await getI18n();
  await io();
  const found = await unpricedRound(roundId, Date.now());
  return found && { lottoName: lottoName(found.lotto, t), roundLabel: roundName(found.round, lang, t) };
}
