import "server-only";
import { io } from "next/cache";
import type { BetTypeCode, LottoGroup, ResultFormat } from "@/domain/types";
import { lottoName, lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { json, q, q1 } from "@/server/db";
import type { SessionUser } from "@/server/services/auth";
import { betConfigs, billLimits, getLotto } from "@/server/services/lottos";
import { roundLimits, type LimitBadge } from "@/server/services/risk";
import { getRound, phaseOf, toRound, type RoundPhase, type RoundRow } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";

export interface BetConfigView {
  code: BetTypeCode;
  label: string;
  short: string;
  digits: number;
  rate100: number;
  maxPerNumber: number;
  minStake: number;
}

export interface SavedSet {
  id: number;
  name: string;
  items: { betType: BetTypeCode; number: string; stake: number }[];
}

export interface BetPageData {
  serverNow: number;
  round: { id: number; label: string; opensAt: number; closesAt: number; drawAt: number; phase: RoundPhase };
  lotto: { id: number; slug: string; name: string; shortName: string; flag: string | null; format: ResultFormat; group: LottoGroup };
  configs: BetConfigView[];
  limits: { minStake: number; maxPerBill: number; maxLines: number };
  badges: LimitBadge[];
  sets: SavedSet[];
  siblings: { id: number; label: string; closesAt: number }[];
  balance: number;
  initialLines: { betType: BetTypeCode; number: string; stake: number }[];
}

export async function getBetPage(roundId: number, viewer: SessionUser, rebetBillId?: number): Promise<BetPageData | null> {
  const { lang, t } = await getI18n();
  await io();
  const now = Date.now();
  const round = await getRound(roundId);
  if (!round) return null;
  const lotto = await getLotto(round.lottoId);
  if (!lotto || !lotto.enabled) return null;

  const [settings, siblingRows, setRows, badges, rebet] = await Promise.all([
    getSettings(),
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
      ? q1<{ id: number }>("SELECT id FROM bills WHERE id = ? AND user_id = ?", rebetBillId, viewer.id).then((bill) =>
          bill
            ? q<{ bet_type: BetTypeCode; number: string; stake: number }>("SELECT bet_type, number, stake FROM bill_items WHERE bill_id = ? ORDER BY id", bill.id)
            : [],
        )
      : Promise.resolve([]),
  ]);

  return {
    serverNow: now,
    round: { id: round.id, label: roundName(round, lang, t), opensAt: round.opensAt, closesAt: round.closesAt, drawAt: round.drawAt, phase: phaseOf(round, now) },
    lotto: { id: lotto.id, slug: lotto.slug, name: lottoName(lotto, t), shortName: lottoShort(lotto, t), flag: lotto.flag, format: lotto.format, group: lotto.group },
    configs: betConfigs(lotto, settings).map(({ code, digits, rate100, maxPerNumber, minStake }) => ({
      code,
      label: t.lotto.betTypes[code].label,
      short: t.lotto.betTypes[code].short,
      digits,
      rate100,
      maxPerNumber,
      minStake,
    })),
    limits: billLimits(lotto, settings),
    badges,
    sets: setRows.map((s) => ({ id: s.id, name: s.name, items: json.parse<SavedSet["items"]>(s.items, []) })),
    siblings: siblingRows.map((r) => {
      const x = toRound(r);
      return { id: x.id, label: roundName(x, lang, t), closesAt: x.closesAt };
    }),
    balance: viewer.balance,
    initialLines: rebet.map((i) => ({ betType: i.bet_type, number: i.number, stake: i.stake })),
  };
}
