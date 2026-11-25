import "server-only";
import { io } from "next/cache";
import type { BillStatus } from "@/domain/labels";
import type { BetTypeCode, ResultFormat, RoundResult, Segment } from "chokprathan-core/rules/types";
import { lottoName, lottoShort, roundName } from "@/i18n/labels";
import { getI18n } from "@/i18n/rsc";
import { json, q, q1 } from "@/server/db";
import { getLotto, listLottos } from "@/server/services/lottos";
import { getRound, phaseOf } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";

export interface BillListItem {
  id: number;
  code: string;
  status: BillStatus;
  totalStake: number;
  totalPayout: number;
  createdAt: number;
  lottoName: string;
  flag: string | null;
  roundLabel: string;
  itemCount: number;
  preview: string;
}

export type BillFilter = "all" | "pending" | "won" | "lost" | "void";
const FILTER_SQL: Record<BillFilter, string> = {
  all: "",
  pending: "AND b.status = 'pending'",
  won: "AND b.status = 'won'",
  lost: "AND b.status = 'lost'",
  void: "AND b.status IN ('cancelled','refunded')",
};

export async function getMyBills(userId: number, filter: BillFilter, limit = 50) {
  const { lang, t } = await getI18n();
  await io();
  const rows = await q<{
    id: number;
    code: string;
    status: BillStatus;
    total_stake: number;
    total_payout: number;
    created_at: number;
    lotto_id: number;
    round_no: number | null;
    closes_at: number;
  }>(
    `SELECT b.id, b.code, b.status, b.total_stake, b.total_payout, b.created_at, r.lotto_id, r.round_no, r.closes_at
     FROM bills b JOIN rounds r ON r.id = b.round_id
     WHERE b.user_id = ? ${FILTER_SQL[filter]}
     ORDER BY b.created_at DESC LIMIT ?`,
    userId,
    limit,
  );
  const [counts, previews, lottos] = await Promise.all([
    q<{ status: BillStatus; n: number }>("SELECT status, COUNT(*) AS n FROM bills WHERE user_id = ? GROUP BY status", userId),
    rows.length
      ? q<{ bill_id: number; number: string; n: number }>(
          `SELECT bill_id, number, n FROM (
             SELECT bill_id, number, ROW_NUMBER() OVER (PARTITION BY bill_id ORDER BY id) AS rn, COUNT(*) OVER (PARTITION BY bill_id) AS n
             FROM bill_items WHERE bill_id IN (?)
           ) x WHERE rn <= 8`,
          rows.map((r) => r.id),
        )
      : Promise.resolve([]),
    listLottos({ includeDisabled: true }),
  ]);
  const byBill = new Map<number, { numbers: string[]; n: number }>();
  for (const p of previews) {
    const e = byBill.get(p.bill_id) ?? { numbers: [], n: p.n };
    e.numbers.push(p.number);
    byBill.set(p.bill_id, e);
  }
  const count = (s: BillStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((sum, c) => sum + c.n, 0);
  return {
    bills: rows.map<BillListItem>((r) => {
      const lotto = lottos.find((l) => l.id === r.lotto_id);
      const p = byBill.get(r.id);
      return {
        id: r.id,
        code: r.code,
        status: r.status,
        totalStake: r.total_stake,
        totalPayout: r.total_payout,
        createdAt: r.created_at,
        lottoName: lotto ? lottoShort(lotto, t) : "-",
        flag: lotto?.flag ?? null,
        roundLabel: roundName({ roundNo: r.round_no, closesAt: r.closes_at }, lang, t),
        itemCount: p?.n ?? 0,
        preview: p?.numbers.join(" ") ?? "",
      };
    }),
    counts: {
      all: count(["pending", "won", "lost", "cancelled", "refunded"]),
      pending: count(["pending"]),
      won: count(["won"]),
      lost: count(["lost"]),
      void: count(["cancelled", "refunded"]),
    } satisfies Record<BillFilter, number>,
  };
}

export interface BillDetail {
  serverNow: number;
  id: number;
  code: string;
  status: BillStatus;
  totalStake: number;
  totalPayout: number;
  createdAt: number;
  settledAt: number | null;
  lotto: { slug: string; name: string; flag: string | null; format: ResultFormat };
  round: { id: number; label: string; closesAt: number; drawAt: number; result: RoundResult | null };
  items: { id: number; betType: BetTypeCode; number: string; stake: number; rate100: number; segments: Segment[]; potential: number; status: BillStatus; payout: number }[];
  cancelUntil: number | null;
  rebetRoundId: number | null;
}

export async function getMyBill(userId: number, billId: number): Promise<BillDetail | null> {
  const { lang, t } = await getI18n();
  await io();
  const now = Date.now();
  const b = await q1<{ id: number; code: string; status: BillStatus; total_stake: number; total_payout: number; created_at: number; settled_at: number | null; round_id: number }>(
    "SELECT id, code, status, total_stake, total_payout, created_at, settled_at, round_id FROM bills WHERE id = ? AND user_id = ?",
    billId,
    userId,
  );
  if (!b) return null;
  const round = (await getRound(b.round_id))!;
  const lotto = (await getLotto(round.lottoId))!;
  const [items, settings, rebet] = await Promise.all([
    q<{ id: number; bet_type: BetTypeCode; number: string; stake: number; rate100: number; segments: string; potential: number; status: BillStatus; payout: number }>(
      "SELECT id, bet_type, number, stake, rate100, segments, potential, status, payout FROM bill_items WHERE bill_id = ? ORDER BY id",
      billId,
    ),
    getSettings(),
    q1<{ id: number }>(
      "SELECT id FROM rounds WHERE lotto_id = ? AND status = 'scheduled' AND opens_at <= ? AND closes_at > ? ORDER BY closes_at LIMIT 1",
      lotto.id,
      now,
      now + 60_000,
    ),
  ]);
  const windowEnd = Math.min(b.created_at + settings.site.cancelWindowMin * 60_000, round.closesAt);
  const cancelUntil = b.status === "pending" && phaseOf(round, now) === "open" && now < windowEnd ? windowEnd : null;
  return {
    serverNow: now,
    id: b.id,
    code: b.code,
    status: b.status,
    totalStake: b.total_stake,
    totalPayout: b.total_payout,
    createdAt: b.created_at,
    settledAt: b.settled_at,
    lotto: { slug: lotto.slug, name: lottoName(lotto, t), flag: lotto.flag, format: lotto.format },
    round: { id: round.id, label: roundName(round, lang, t), closesAt: round.closesAt, drawAt: round.drawAt, result: round.result },
    items: items.map((i) => ({
      id: i.id,
      betType: i.bet_type,
      number: i.number,
      stake: i.stake,
      rate100: i.rate100,
      segments: json.parse<Segment[]>(i.segments, []),
      potential: i.potential,
      status: i.status,
      payout: i.payout,
    })),
    cancelUntil,
    rebetRoundId: rebet?.id ?? null,
  };
}
