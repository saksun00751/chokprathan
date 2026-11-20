import "server-only";
import { io } from "next/cache";
import type { BetTypeCode, LottoGroup, RoundResult } from "@/domain/types";
import type { Dict } from "@/i18n/dictionaries";
import { lottoName, lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import type { Locale } from "@/i18n/config";
import { memo } from "@/server/cache";
import { LOBBY_TTL_MS, RESULTS_TTL_MS } from "@/server/cache-ttl";
import { q } from "@/server/db";
import { betConfigs, listLottos, type Lotto } from "@/server/services/lottos";
import { limitsForRounds } from "@/server/services/risk";
import { phaseOf, toRound, type Round, type RoundPhase, type RoundRow } from "@/server/services/rounds";
import { getSettings, type AllSettings } from "@/server/services/settings";

export interface LobbyRound {
  id: number;
  lottoId: number;
  slug: string;
  name: string;
  shortName: string;
  group: LottoGroup;
  flag: string | null;
  label: string;
  roundNo: number | null;
  opensAt: number;
  closesAt: number;
  drawAt: number;
  status: Round["status"];
  phase: RoundPhase;
  headline: { code: BetTypeCode; short: string; rate100: number }[];
  cutCount: number;
}

export function toLobbyRound(round: Round, lotto: Lotto, now: number, settings: AllSettings, cutCount: number, lang: Locale, t: Dict): LobbyRound {
  const configs = betConfigs(lotto, settings);
  const headlineCodes: BetTypeCode[] = lotto.format === "laos4" ? ["top4", "top3", "top2"] : ["top3", "top2"];
  return {
    id: round.id,
    lottoId: lotto.id,
    slug: lotto.slug,
    name: lottoName(lotto, t),
    shortName: lottoShort(lotto, t),
    group: lotto.group,
    flag: lotto.flag,
    label: roundName(round, lang, t),
    roundNo: round.roundNo,
    opensAt: round.opensAt,
    closesAt: round.closesAt,
    drawAt: round.drawAt,
    status: round.status,
    phase: phaseOf(round, now),
    headline: headlineCodes.flatMap((code) => {
      const c = configs.find((x) => x.code === code);
      return c ? [{ code, short: t.lotto.betTypes[code].short, rate100: c.rate100 }] : [];
    }),
    cutCount,
  };
}

export interface LobbyData {
  serverNow: number;
  rounds: LobbyRound[];
  yiki: LobbyRound[];
}

/**
 * The round each lotto is taking bets for now (or its next one), plus upcoming Yiki rounds.
 * The same for every visitor, so it is built at most once every few seconds per instance.
 */
type Picked = { round: Round; lotto: Lotto; yiki: boolean; cuts: number };

function lobbySnapshot(): Promise<{ builtAt: number; picked: Picked[]; settings: AllSettings }> {
  return memo("lobby", LOBBY_TTL_MS, async () => {
    const now = Date.now();
    const [lottos, settings] = await Promise.all([listLottos(), getSettings()]);
    const byId = new Map(lottos.map((l) => [l.id, l]));
    const live = (
      await q<RoundRow>(
        "SELECT * FROM rounds WHERE status = 'scheduled' AND closes_at > ? AND opens_at <= ? ORDER BY closes_at LIMIT 600",
        now,
        now + 16 * 86_400_000,
      )
    ).map(toRound);

    const seen = new Set<number>();
    const picked: Picked[] = [];
    let yikiCount = 0;
    for (const r of live) {
      const lotto = byId.get(r.lottoId);
      if (!lotto) continue;
      if (lotto.group === "yiki") {
        if (yikiCount < 12 && r.opensAt <= now) {
          picked.push({ round: r, lotto, yiki: true, cuts: 0 });
          yikiCount++;
        }
        continue;
      }
      if (seen.has(lotto.id)) continue;
      seen.add(lotto.id);
      picked.push({ round: r, lotto, yiki: false, cuts: 0 });
    }
    const cuts = await limitsForRounds(picked.map((p) => p.round.id));
    for (const p of picked) p.cuts = cuts.get(p.round.id)?.length ?? 0;
    return { builtAt: now, picked, settings };
  });
}

export async function getLobby(): Promise<LobbyData> {
  const { lang, t } = await getI18n();
  await io();
  const snap = await lobbySnapshot();
  const now = Date.now();
  // Shared snapshot, then this request's language and clock.
  const live = snap.picked.filter((p) => p.round.closesAt > now);
  const view = (p: Picked) => toLobbyRound(p.round, p.lotto, now, snap.settings, p.cuts, lang, t);
  return { serverNow: now, rounds: live.filter((p) => !p.yiki).map(view), yiki: live.filter((p) => p.yiki).map(view) };
}

export interface LatestResult {
  roundId: number;
  slug: string;
  name: string;
  shortName: string;
  group: LottoGroup;
  flag: string | null;
  format: Lotto["format"];
  label: string;
  roundNo: number | null;
  closesAt: number;
  resultedAt: number;
  result: RoundResult;
}

/** The latest result of every lotto. One query, cached briefly. */
export async function getLatestResults(limit = 40): Promise<{ serverNow: number; results: LatestResult[] }> {
  const { lang, t } = await getI18n();
  await io();
  const raw = await memo("results:latest", RESULTS_TTL_MS, async () => {
    const lottos = await listLottos();
    const byId = new Map(lottos.map((l) => [l.id, l]));
    const rows = await q<RoundRow>(
      `SELECT r.* FROM rounds r
       JOIN (SELECT lotto_id, MAX(closes_at) AS c FROM rounds WHERE status = 'resulted' GROUP BY lotto_id) x
         ON x.lotto_id = r.lotto_id AND x.c = r.closes_at`,
    );
    const out: LatestResult[] = [];
    for (const row of rows) {
      const r = toRound(row);
      const lotto = byId.get(r.lottoId);
      if (!lotto || !r.result) continue;
      out.push({
        roundId: r.id,
        slug: lotto.slug,
        name: lotto.name,
        shortName: lotto.shortName,
        group: lotto.group,
        flag: lotto.flag,
        format: lotto.format,
        label: "",
        roundNo: r.roundNo,
        closesAt: r.closesAt,
        resultedAt: r.resultedAt ?? r.closesAt,
        result: r.result,
      });
    }
    return out.sort((a, b) => b.resultedAt - a.resultedAt);
  });
  const results = raw.slice(0, limit).map((r) => ({ ...r, name: lottoName(r, t), shortName: lottoShort(r, t), label: roundName(r, lang, t) }));
  return { serverNow: Date.now(), results };
}
