import "server-only";
import { io } from "next/cache";
import { dayKey, dayStartMs } from "chokprathan-core/rules/time";
import { lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { q, q1, tolerateMissingTable } from "@/server/db";
import { listLottos } from "@/server/services/lottos";
import { getSetting } from "@/server/services/settings";
import { getViewer } from "@/server/session";

export interface MyGuess {
  id: number;
  roundId: number;
  number: string;
  status: "pending" | "won" | "lost" | "refunded";
  paid: number;
  createdAt: number;
  label: string;
}

/**
 * The member activities page: the wheel's prizes and odds (shown openly), the rounds open for
 * guessing, and, for a signed-in member, their points, spins left today, and guesses.
 */
export async function getActivitiesPage() {
  const { lang, t } = await getI18n();
  // Live data (settings, balances, open rounds): rendered per request, never prerendered.
  await io();
  const [viewer, settings, rule] = await Promise.all([getViewer(), getSetting("activities"), getSetting("points")]);
  const now = Date.now();
  const today = dayStartMs(dayKey(now));
  const { wheel, guess } = settings;
  const lottos = await listLottos({ includeDisabled: true });
  const lottoName = (id: number) => {
    const l = lottos.find((x) => x.id === id);
    return l ? lottoShort(l, t) : "-";
  };
  const label = (r: { lotto_id: number; round_no: number | null; closes_at: number; planned_close: number | null }) =>
    `${lottoName(r.lotto_id)} ${roundName({ roundNo: r.round_no, closesAt: r.closes_at, plannedClose: r.planned_close }, lang, t)}`;

  const rounds =
    guess.enabled && guess.lottoIds.length > 0
      ? await q<{ id: number; lotto_id: number; round_no: number | null; closes_at: number; planned_close: number | null }>(
          `SELECT id, lotto_id, round_no, closes_at, planned_close FROM rounds
           WHERE lotto_id IN (${guess.lottoIds.map(() => "?").join(", ")}) AND status = 'scheduled' AND opens_at <= ? AND closes_at > ?
           ORDER BY closes_at LIMIT 12`,
          ...guess.lottoIds,
          now,
          now,
        )
      : [];

  let me: { points: number; spinsToday: number; recentSpins: { id: number; prize: number; createdAt: number }[]; guesses: MyGuess[] } | null = null;
  if (viewer && viewer.role === "member") {
    const [points, spins, recent, guesses] = await Promise.all([
      tolerateMissingTable(() => q1<{ points: number }>("SELECT points FROM member_points WHERE user_id = ?", viewer.id), undefined),
      tolerateMissingTable(() => q1<{ n: number }>("SELECT COUNT(*) AS n FROM wheel_spins WHERE user_id = ? AND created_at >= ?", viewer.id, today), undefined),
      tolerateMissingTable(
        () =>
          q<{ id: number; prize: number; created_at: number }>(
            "SELECT id, prize, created_at FROM wheel_spins WHERE user_id = ? ORDER BY id DESC LIMIT 8",
            viewer.id,
          ),
        [],
      ),
      tolerateMissingTable(
        () =>
          q<{
            id: number;
            round_id: number;
            number: string;
            status: MyGuess["status"];
            paid: number;
            created_at: number;
            lotto_id: number;
            round_no: number | null;
            closes_at: number;
            planned_close: number | null;
          }>(
            `SELECT g.id, g.round_id, g.number, g.status, g.paid, g.created_at, r.lotto_id, r.round_no, r.closes_at, r.planned_close
             FROM point_guesses g JOIN rounds r ON r.id = g.round_id WHERE g.user_id = ? ORDER BY g.id DESC LIMIT 30`,
            viewer.id,
          ),
        [],
      ),
    ]);
    me = {
      points: Number(points?.points ?? 0),
      spinsToday: Number(spins?.n ?? 0),
      recentSpins: recent.map((s) => ({ id: s.id, prize: Number(s.prize), createdAt: s.created_at })),
      guesses: guesses.map((g) => ({
        id: g.id,
        roundId: g.round_id,
        number: g.number,
        status: g.status,
        paid: Number(g.paid),
        createdAt: g.created_at,
        label: label(g),
      })),
    };
  }

  return {
    signedIn: !!me,
    me,
    pointRule: rule,
    wheel: { enabled: wheel.enabled, cost: wheel.cost, dailyLimit: wheel.dailyLimit, turnoverX: wheel.turnoverX, prizes: wheel.prizes },
    guess: {
      enabled: guess.enabled,
      cost: guess.cost,
      prize: guess.prize,
      maxPerRound: guess.maxPerRound,
      turnoverX: guess.turnoverX,
      shared: guess.roundBudget > 0,
      rounds: rounds.map((r) => ({ id: r.id, label: label(r), closesAt: r.closes_at })),
    },
  };
}
