import "server-only";
import type { Dict } from "@/i18n/dictionaries";
import { fmt, formatNumber } from "@/i18n/format";
import { serverI18n } from "@/i18n/server";
import { createHash, randomInt } from "node:crypto";
import { BET_TYPES, isValidNumber } from "chokprathan-core/rules/betTypes";
import { formatBaht } from "chokprathan-core/rules/money";
import { priceSlip, slipKey, type PricedLine, type LineReason, type SlipLine } from "chokprathan-core/rules/quote";
import type { RoundConfig } from "chokprathan-core/rules/roundConfig";
import type { BetTypeCode, ManualLimit } from "chokprathan-core/rules/types";
import { invalidate } from "@/server/cache";
import { afterCommit, insertMany, json, q, q1, run, tx, type SqlValue } from "@/server/db";
import { getLotto } from "./lottos";
import { getRoundConfig } from "./round-config";
import { phaseOf, roundLabel, toRound, type Round, type RoundRow } from "./rounds";
import { getSettings } from "./settings";
import { move } from "./wallet";

export { settlePending as settleRound } from "./settlement";

export type { SlipLine };
export type LineRejectReason = LineReason;

export type LineQuote = Extract<PricedLine, { ok: true }> | (Extract<PricedLine, { ok: false }> & { message: string });

export type QuoteError = "round_not_found" | "round_closed" | "round_not_open" | "bad_package" | "empty" | "too_many_lines" | "over_bill_limit";

export interface Quote {
  roundId: number;
  ok: boolean;
  packageId: number;
  lines: LineQuote[];
  /** whole baht, before discount */
  totalStake: number;
  /** satang */
  totalDiscount: number;
  /** satang the member pays */
  totalNet: number;
  fingerprint: string;
  error?: QuoteError;
  message?: string;
}

export type PlaceError = "round_closed" | "invalid" | "rate_changed" | "insufficient_balance" | "suspended";
export type PlaceResult =
  | { ok: true; billId: number; code: string; balance: number; paid: number; quote?: Quote }
  | { ok: false; error: PlaceError; message: string; quote?: Quote };

export async function manualLimitsMap(roundId: number): Promise<Map<string, ManualLimit>> {
  const rows = await q<{ bet_type: string; number: string; kind: "percent" | "closed"; percent: number | null }>(
    "SELECT bet_type, number, kind, percent FROM manual_limits WHERE round_id = ?",
    roundId,
  );
  return new Map(
    rows.map((r) => [
      slipKey(r.bet_type, r.number),
      r.kind === "closed" ? { kind: "closed" } : { kind: "percent", percent: r.percent ?? 100 },
    ]),
  );
}

/** Lines whose bet type and number could be priced: only these need an exposure row. */
function priceableKeys(lines: SlipLine[]): { betType: BetTypeCode; number: string }[] {
  const seen = new Map<string, { betType: BetTypeCode; number: string }>();
  for (const l of lines) {
    if (BET_TYPES[l.betType] && isValidNumber(l.betType, l.number)) seen.set(slipKey(l.betType, l.number), { betType: l.betType, number: l.number });
  }
  // A fixed order: two bills locking the same numbers always take the locks in the same sequence.
  return [...seen.values()].sort((a, b) => a.betType.localeCompare(b.betType) || a.number.localeCompare(b.number));
}

/** Baht this member already holds, per number, in pending bills of the round. */
async function heldStakes(userId: number, roundId: number, keys: { number: string }[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await q<{ bet_type: string; number: string; s: number | string }>(
    `SELECT i.bet_type, i.number, SUM(i.stake) AS s FROM bills b JOIN bill_items i ON i.bill_id = b.id
     WHERE b.user_id = ? AND b.round_id = ? AND b.status = 'pending' AND i.number IN (?)
     GROUP BY i.bet_type, i.number`,
    userId,
    roundId,
    [...new Set(keys.map((k) => k.number))],
  );
  return new Map(rows.map((r) => [slipKey(r.bet_type, r.number), Number(r.s)]));
}

async function exposureTotals(roundId: number, keys: { betType: BetTypeCode; number: string }[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await q<{ bet_type: string; number: string; total_stake: number }>(
    "SELECT bet_type, number, total_stake FROM exposures WHERE round_id = ? AND bet_type IN (?) AND number IN (?)",
    roundId,
    [...new Set(keys.map((k) => k.betType))],
    [...new Set(keys.map((k) => k.number))],
  );
  return new Map(rows.map((r) => [slipKey(r.bet_type, r.number), r.total_stake]));
}

/**
 * Make sure every number on the slip has an exposure row, outside any transaction. Rows are
 * created with a short autocommit INSERT IGNORE, so the bet transaction afterwards only needs
 * exact-key record locks (an INSERT ... ON DUPLICATE KEY UPDATE would take gap locks even under
 * READ COMMITTED and make bills on unrelated numbers queue behind each other).
 */
async function ensureExposureRows(roundId: number, keys: { betType: BetTypeCode; number: string }[]) {
  if (keys.length === 0) return;
  const existing = await exposureTotals(roundId, keys);
  const missing = keys.filter((k) => !existing.has(slipKey(k.betType, k.number)));
  if (missing.length === 0) return;
  await run(
    `INSERT IGNORE INTO exposures (round_id, bet_type, number) VALUES ${missing.map(() => "(?, ?, ?)").join(", ")}`,
    ...missing.flatMap((k) => [roundId, k.betType, k.number]),
  );
}

/** Lock the slip's numbers (bet type, then number order: the same order for every bill) and read their totals. */
async function lockExposures(roundId: number, keys: { betType: BetTypeCode; number: string }[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const byType = new Map<string, string[]>();
  for (const k of keys) byType.set(k.betType, [...(byType.get(k.betType) ?? []), k.number]);
  for (const betType of [...byType.keys()].sort()) {
    const rows = await q<{ number: string; total_stake: number }>(
      "SELECT number, total_stake FROM exposures WHERE round_id = ? AND bet_type = ? AND number IN (?) ORDER BY number FOR UPDATE",
      roundId,
      betType,
      [...new Set(byType.get(betType))].sort(),
    );
    for (const r of rows) totals.set(slipKey(betType, r.number), r.total_stake);
  }
  return totals;
}

function fingerprintOf(packageId: number, lines: LineQuote[]): string {
  const shape = lines.map((l) => [l.betType, l.number, l.stake, l.ok ? [l.segments, l.discount] : l.reason]);
  return createHash("sha1").update(JSON.stringify([packageId, shape])).digest("hex").slice(0, 16);
}

const failQuote = (roundId: number, error: QuoteError, message: string): Quote => ({
  roundId,
  ok: false,
  packageId: 0,
  lines: [],
  totalStake: 0,
  totalDiscount: 0,
  totalNet: 0,
  fingerprint: "",
  error,
  message,
});

interface QuoteInput {
  /** Messages and bet type names in the request's language. */
  e: Dict["errors"];
  betLabels: Dict["lotto"]["betTypes"];
  round: Round | undefined;
  config: RoundConfig | undefined;
  packageId?: number;
  manual: Map<string, ManualLimit>;
  totals: Map<string, number>;
  held: Map<string, number>;
}

/** `priceSlip` with the round's phase checked and every refusal put into words. */
function quoteLines(roundId: number, lines: SlipLine[], now: number, { e, betLabels, round, config, packageId, manual, totals, held }: QuoteInput): Quote {
  const m = e.bet;
  if (!round) return failQuote(roundId, "round_not_found", m.roundNotFound);
  const phase = phaseOf(round, now);
  if (phase === "upcoming") return failQuote(roundId, "round_not_open", m.roundNotOpen);
  if (phase !== "open") return failQuote(roundId, "round_closed", m.roundClosed);
  // The back office stores it with the round; for the few minutes it may be missing, nothing is taken.
  if (!config) return failQuote(roundId, "round_not_open", m.roundNotOpen);

  const priced = priceSlip({ config, packageId, lines, manual, totals, held });
  const words = (l: Extract<PricedLine, { ok: false }>) => {
    switch (l.reason) {
      case "unavailable":
        return fmt(m.typeUnavailable, { type: BET_TYPES[l.betType] ? betLabels[l.betType].label : m.thisType });
      case "invalid":
        return fmt(m.digits, { n: BET_TYPES[l.betType].digits });
      case "min":
        return fmt(m.minStake, { n: formatNumber(l.limit ?? 0) });
      case "max":
        return fmt(m.maxPerNumber, { n: formatNumber(l.limit ?? 0) });
      case "closed":
        return m.numberClosed;
      case "cap":
        return l.remaining ? fmt(m.remaining, { n: formatNumber(l.remaining) }) : m.full;
    }
  };
  const quoted: LineQuote[] = priced.lines.map((l) => (l.ok ? l : { ...l, message: words(l) }));
  const quote: Quote = { ...priced, error: undefined, roundId, lines: quoted, fingerprint: fingerprintOf(priced.packageId, quoted) };
  switch (priced.error) {
    case undefined:
      return quote;
    case "package":
      return { ...quote, error: "bad_package", message: m.packageGone };
    case "empty":
      return { ...quote, error: "empty", message: m.empty };
    case "too_many_lines":
      return { ...quote, error: "too_many_lines", message: fmt(m.tooManyLines, { n: config.maxLines }) };
    case "over_bill_limit":
      return { ...quote, error: "over_bill_limit", message: fmt(m.overBill, { n: formatNumber(config.maxPerBill) }) };
  }
}

/** Price a slip for review. Reads only; placing re-prices under locks. */
export async function quoteBill(userId: number, roundId: number, lines: SlipLine[], now = Date.now(), packageId?: number): Promise<Quote> {
  const { t } = await serverI18n();
  const e = t.errors;
  const row = await q1<RoundRow>("SELECT * FROM rounds WHERE id = ?", roundId);
  const round = row && toRound(row);
  if (!round) return failQuote(roundId, "round_not_found", e.bet.roundNotFound);
  const keys = priceableKeys(lines);
  const [stored, manual, totals, held] = await Promise.all([
    getRoundConfig(roundId),
    manualLimitsMap(roundId),
    exposureTotals(roundId, keys),
    heldStakes(userId, roundId, keys),
  ]);
  return quoteLines(roundId, lines, now, { e, betLabels: t.lotto.betTypes, round, config: stored?.config, packageId, manual, totals, held });
}

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newBillCode(): string {
  let code = "CP";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

/** Thrown inside the transaction to roll back a refused bill (and the exposure rows it locked). */
class Refused extends Error {
  constructor(readonly result: PlaceResult) {
    super("refused");
  }
}

/**
 * Price and place a bill atomically. Locks, in order: the round (shared, so the draw cannot
 * settle mid-bet), the member's wallet, then every number on the slip. Two bills on the same
 * number therefore price one after the other and the second sees the first one's stake.
 * If `expected` (the fingerprint the member confirmed) no longer matches, nothing is placed
 * unless `acceptChanges` is set.
 */
export async function placeBill(
  userId: number,
  roundId: number,
  lines: SlipLine[],
  {
    expected,
    acceptChanges = false,
    now = Date.now(),
    note,
    packageId,
    requestId,
  }: { expected?: string; acceptChanges?: boolean; now?: number; note?: string; packageId?: number; requestId?: string } = {},
): Promise<PlaceResult> {
  const { t } = await serverI18n();
  const e = t.errors;
  const preview = await q1<RoundRow>("SELECT * FROM rounds WHERE id = ?", roundId);
  // Cached lottery data is read before the transaction starts.
  const lotto = preview ? await getLotto(preview.lotto_id) : undefined;
  if (preview && phaseOf(toRound(preview), now) === "open") await ensureExposureRows(roundId, priceableKeys(lines));
  try {
    const placed = await tx(async (): Promise<PlaceResult> => {
      const refuse = (r: PlaceResult): never => {
        throw new Refused(r);
      };
      const row = await q1<RoundRow>("SELECT * FROM rounds WHERE id = ? LOCK IN SHARE MODE", roundId);
      const round = row && toRound(row);
      const user = await q1<{ status: string; balance: number; role: string }>("SELECT status, balance, role FROM users WHERE id = ? FOR UPDATE", userId);
      if (!user || user.status !== "active" || user.role !== "member") refuse({ ok: false, error: "suspended", message: e.bet.suspended });

      // Under the member's lock, so two sends of one request cannot both get past this.
      if (requestId) {
        const first = await q1<{ id: number; code: string; total_stake: number }>(
          "SELECT id, code, total_stake FROM bills WHERE user_id = ? AND request_id = ?",
          userId,
          requestId,
        );
        if (first) return { ok: true, billId: first.id, code: first.code, balance: user!.balance, paid: first.total_stake };
      }

      // Read before taking the number locks: everything after the locks should be short.
      // The config cannot change now: the back office takes the round row exclusively to rewrite it.
      const stored = await getRoundConfig(roundId);
      const manual = await manualLimitsMap(roundId);
      const keys = round && phaseOf(round, now) === "open" ? priceableKeys(lines) : [];
      const held = await heldStakes(userId, roundId, keys);
      const totals = await lockExposures(roundId, keys);
      const missing = keys.filter((k) => !totals.has(slipKey(k.betType, k.number)));
      if (missing.length) {
        // A row the pre-step could not create (very rare race): create it now under the lock.
        await run(
          `INSERT IGNORE INTO exposures (round_id, bet_type, number) VALUES ${missing.map(() => "(?, ?, ?)").join(", ")}`,
          ...missing.flatMap((k) => [roundId, k.betType, k.number]),
        );
        for (const [k, v] of await lockExposures(roundId, missing)) totals.set(k, v);
      }
      const quote = quoteLines(roundId, lines, now, { e, betLabels: t.lotto.betTypes, round, config: stored?.config, packageId, manual, totals, held });
      if (quote.error === "round_closed" || quote.error === "round_not_open" || quote.error === "round_not_found") {
        refuse({ ok: false, error: "round_closed", message: quote.message ?? e.bet.roundClosed, quote });
      }
      if (quote.error || !quote.ok) {
        refuse({ ok: false, error: "invalid", message: quote.message ?? e.bet.someInvalid, quote });
      }
      if (expected && expected !== quote.fingerprint && !acceptChanges) {
        refuse({ ok: false, error: "rate_changed", message: e.bet.rateChanged, quote });
      }
      if (user!.balance < quote.totalNet) {
        refuse({ ok: false, error: "insufficient_balance", message: fmt(e.bet.insufficient, { amount: formatBaht(quote.totalNet - user!.balance) }), quote });
      }

      let code = newBillCode();
      let billId = 0;
      for (let attempt = 0; ; attempt++) {
        try {
          billId = (
            await run(
              `INSERT INTO bills (code, user_id, round_id, total_stake, discount, package_id, config_version, request_id, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              code,
              userId,
              roundId,
              quote.totalNet,
              quote.totalDiscount,
              quote.packageId,
              stored!.version,
              requestId ?? null,
              note?.slice(0, 255) ?? null,
              now,
            )
          ).lastId;
          break;
        } catch (error) {
          if ((error as { errno?: number }).errno !== 1062 || attempt >= 5) throw error;
          code = newBillCode(); // a code collision only fails this statement, not the transaction
        }
      }

      const okLines = quote.lines.filter((l): l is Extract<LineQuote, { ok: true }> => l.ok);
      await insertMany(
        "bill_items",
        ["bill_id", "round_id", "bet_type", "number", "stake", "discount", "segments", "rate100", "potential"],
        okLines.map((l) => [billId, roundId, l.betType, l.number, l.stake, l.discount, json.str(l.segments), l.rate100, l.potential]),
      );
      const byKey = new Map<string, { betType: string; number: string; stake: number; potential: number }>();
      for (const l of okLines) {
        const k = slipKey(l.betType, l.number);
        const agg = byKey.get(k) ?? { betType: l.betType, number: l.number, stake: 0, potential: 0 };
        agg.stake += l.stake;
        agg.potential += l.potential;
        byKey.set(k, agg);
      }
      const adds = [...byKey.values()];
      for (const betType of [...new Set(adds.map((a) => a.betType))].sort()) {
        const part = adds.filter((a) => a.betType === betType);
        const byNumber = `CASE number ${part.map(() => "WHEN ? THEN ?").join(" ")} ELSE 0 END`;
        await run(
          `UPDATE exposures SET total_stake = total_stake + ${byNumber}, potential = potential + ${byNumber}
           WHERE round_id = ? AND bet_type = ? AND number IN (?)`,
          ...part.flatMap((a): SqlValue[] => [a.number, a.stake]),
          ...part.flatMap((a): SqlValue[] => [a.number, a.potential]),
          roundId,
          betType,
          part.map((a) => a.number),
        );
      }

      // The wallet row has been locked since the start, so the balance read then is exact.
      const balance = user!.balance - quote.totalNet;
      await run("UPDATE users SET balance = balance - ? WHERE id = ?", quote.totalNet, userId);
      await run(
        "INSERT INTO transactions (user_id, wallet, type, amount, balance_after, ref, note, created_at) VALUES (?, 'balance', 'bet', ?, ?, ?, ?, ?)",
        userId,
        -quote.totalNet,
        balance,
        code,
        `${lotto!.shortName} ${roundLabel(round!)}`.slice(0, 255),
        now,
      );
      afterCommit(() => invalidate(`limits:${roundId}`));
      return { ok: true, billId, code, balance, paid: quote.totalNet, quote };
    });
    return placed;
  } catch (error) {
    if (error instanceof Refused) return error.result;
    throw error;
  }
}

export type CancelResult = { ok: true } | { ok: false; error: "not_found" | "not_pending" | "round_closed" | "window_passed" };

export async function cancelBill(userId: number, billId: number, now = Date.now()): Promise<CancelResult> {
  const { site } = await getSettings();
  return tx(async (): Promise<CancelResult> => {
    const bill = await q1<{ id: number; code: string; status: string; total_stake: number; created_at: number; round_id: number }>(
      "SELECT id, code, status, total_stake, created_at, round_id FROM bills WHERE id = ? AND user_id = ? FOR UPDATE",
      billId,
      userId,
    );
    if (!bill) return { ok: false, error: "not_found" };
    if (bill.status !== "pending") return { ok: false, error: "not_pending" };
    const round = await q1<{ closes_at: number; status: string }>("SELECT closes_at, status FROM rounds WHERE id = ? LOCK IN SHARE MODE", bill.round_id);
    if (!round || round.status !== "scheduled" || now >= round.closes_at) return { ok: false, error: "round_closed" };
    if (now - bill.created_at > site.cancelWindowMin * 60_000) return { ok: false, error: "window_passed" };
    if (now > round.closes_at - site.cancelCutoffMin * 60_000) return { ok: false, error: "window_passed" };

    await q1("SELECT id FROM users WHERE id = ? FOR UPDATE", userId); // wallet before numbers, like placeBill
    const items = await q<{ bet_type: string; number: string; stake: number; potential: number }>(
      "SELECT bet_type, number, stake, potential FROM bill_items WHERE bill_id = ? AND status = 'pending' ORDER BY bet_type, number",
      billId,
    );
    for (const it of items) {
      await run(
        `UPDATE exposures SET total_stake = total_stake - ?, potential = potential - ?
         WHERE round_id = ? AND bet_type = ? AND number = ?`,
        it.stake,
        it.potential,
        bill.round_id,
        it.bet_type,
        it.number,
      );
    }
    await run("UPDATE bill_items SET status = 'cancelled' WHERE bill_id = ?", billId);
    await run("UPDATE bills SET status = 'cancelled', settled_at = ? WHERE id = ?", now, billId);
    await move(userId, "balance", bill.total_stake, "refund", { ref: bill.code, note: "ยกเลิกโพย", now });
    afterCommit(() => invalidate(`limits:${bill.round_id}`));
    return { ok: true };
  });
}
