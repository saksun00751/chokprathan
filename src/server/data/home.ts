import "server-only";
import { io } from "next/cache";
import type { BetTypeCode } from "chokprathan-core/rules/types";
import { lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { q1 } from "@/server/db";
import { getLotto } from "@/server/services/lottos";
import { limitsForRounds } from "@/server/services/risk";
import { toRound, type RoundRow } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";
import { getLobby, toLobbyRound, type LobbyRound } from "./lobby";

export interface CutSample {
  roundId: number;
  lottoName: string;
  label: string;
  betLabel: string;
  betType: BetTypeCode;
  number: string;
  rate100: number | null;
  baseRate100: number;
}

export async function getHomeData() {
  const { lang, t } = await getI18n();
  const lobby = await getLobby();
  const now = lobby.serverNow;
  const open = lobby.rounds.filter((r) => r.phase === "open");
  const closingSoon = [...open, ...lobby.yiki.slice(0, 1)].sort((a, b) => a.closesAt - b.closesAt).slice(0, 6);

  const ranked = [...open]
    .sort((a, b) => Number(b.group === "thai") - Number(a.group === "thai") || b.cutCount - a.cutCount)
    .filter((x) => x.cutCount > 0)
    .slice(0, 4);
  const limits = await limitsForRounds(ranked.map((r) => r.id));
  const cutSamples: CutSample[] = [];
  for (const r of ranked) {
    const badge = (limits.get(r.id) ?? [])
      .filter((b) => b.betType === "top2" || b.betType === "bottom2" || b.betType === "top3")
      // reduced-but-open numbers explain the feature best; closed ones come after
      .sort((a, b) => Number(a.rate100 === null) - Number(b.rate100 === null) || (a.rate100 ?? 0) - (b.rate100 ?? 0))[0];
    if (badge) {
      cutSamples.push({
        roundId: r.id,
        lottoName: r.shortName,
        label: r.label,
        betLabel: t.lotto.betTypes[badge.betType].label,
        betType: badge.betType,
        number: badge.number,
        rate100: badge.rate100,
        baseRate100: badge.baseRate100,
      });
    }
  }

  const govRow = await q1<RoundRow>(
    `SELECT r.* FROM rounds r JOIN lottos l ON l.id = r.lotto_id
     WHERE l.slug = 'thai-gov' AND r.status = 'scheduled' AND r.closes_at > ? ORDER BY r.closes_at LIMIT 1`,
    now,
  );
  let gov: LobbyRound | null = null;
  if (govRow) {
    const round = toRound(govRow);
    const lotto = await getLotto(round.lottoId);
    if (lotto) gov = toLobbyRound(round, lotto, now, await getSettings(), 0, lang, t);
  }

  return { serverNow: now, closingSoon, cutSamples, gov };
}

export async function getMemberSummary(userId: number) {
  const { lang, t } = await getI18n();
  await io();
  const now = Date.now();
  const r = (await q1<{ n: number; stake: number | null; week: number | null }>(
    `SELECT
       (SELECT COUNT(*) FROM bills WHERE user_id = ? AND status = 'pending') AS n,
       (SELECT SUM(total_stake) FROM bills WHERE user_id = ? AND status = 'pending') AS stake,
       (SELECT SUM(total_payout) FROM bills WHERE user_id = ? AND status = 'won' AND settled_at > ?) AS week`,
    userId,
    userId,
    userId,
    now - 7 * 86_400_000,
  ))!;
  const lastWin = await q1<RoundRow & { total_payout: number; bill_settled_at: number }>(
    `SELECT r.*, b.total_payout, b.settled_at AS bill_settled_at FROM bills b JOIN rounds r ON r.id = b.round_id
     WHERE b.user_id = ? AND b.status = 'won' ORDER BY b.settled_at DESC LIMIT 1`,
    userId,
  );
  let lastWinInfo: { amount: number; at: number; lotto: string; label: string } | null = null;
  if (lastWin) {
    const round = toRound(lastWin);
    const lotto = await getLotto(round.lottoId);
    if (lotto) lastWinInfo = { amount: lastWin.total_payout, at: lastWin.bill_settled_at, lotto: lottoShort(lotto, t), label: roundName(round, lang, t) };
  }
  return {
    pendingBills: r.n,
    pendingStake: r.stake ?? 0,
    lastWin: lastWinInfo,
    weekWinnings: r.week ?? 0,
  };
}
