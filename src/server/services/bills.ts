import "server-only";
import type { Dict } from "@/i18n/dictionaries";
import { fmt, formatNumber } from "@/i18n/format";
import { serverI18n } from "@/i18n/server";
import { createHash, randomInt } from "node:crypto";
import { BET_TYPES, isValidNumber } from "@/domain/betTypes";
import { averageRate100, formatBaht, payoutOf } from "@/domain/money";
import { priceStake } from "@/domain/pricing";
import type { BetTypeCode, ManualLimit, Segment } from "@/domain/types";
import { invalidate } from "@/server/cache";
import { afterCommit, insertMany, json, q, q1, run, tx, type SqlValue } from "@/server/db";
import { betConfigs, billLimits, getLotto, type Lotto } from "./lottos";
import { phaseOf, roundLabel, toRound, type Round, type RoundRow } from "./rounds";
import { getSettings, type AllSettings } from "./settings";
import { move } from "./wallet";

export { settlePending as settleRound } from "./settlement";

export interface SlipLine {
  betType: BetTypeCode;
  number: string;
  /** whole baht */
  stake: number;
}

export type LineRejectReason = "unavailable" | "invalid" | "min" | "max" | "closed" | "cap";

type LineBase = { betType: BetTypeCode; number: string; stake: number; baseRate100: number };
export type LineQuote =
  | (LineBase & { ok: true; segments: Segment[]; rate100: number; potential: number; reduced: boolean })
  | (LineBase & { ok: false; reason: LineRejectReason; remaining?: number; message: string });

export type QuoteError = "round_not_found" | "round_closed" | "round_not_open" | "empty" | "too_many_lines" | "over_bill_limit";

export interface Quote {
  roundId: number;
  ok: boolean;
  lines: LineQuote[];
  /** whole baht */
  totalStake: number;
  fingerprint: string;
  error?: QuoteError;
  message?: string;
}

export type PlaceError = "round_closed" | "invalid" | "rate_changed" | "insufficient_balance" | "suspended";
export type PlaceResult =
  | { ok: true; billId: number; code: string; balance: number; quote: Quote }
  | { ok: false; error: PlaceError; message: string; quote?: Quote };

const keyOf = (betType: string, number: string) => `${betType}:${number}`;

export async function manualLimitsMap(roundId: number): Promise<Map<string, ManualLimit>> {
  const rows = await q<{ bet_type: string; number: string; kind: "percent" | "closed"; percent: number | null }>(
    "SELECT bet_type, number, kind, percent FROM manual_limits WHERE round_id = ?",
    roundId,
  );
  return new Map(
    rows.map((r) => [
      keyOf(r.bet_type, r.number),
      r.kind === "closed" ? { kind: "closed" } : { kind: "percent", percent: r.percent ?? 100 },
    ]),
  );
}

/** Lines whose bet type and number could be priced: only these need an exposure row. */
function priceableKeys(lines: SlipLine[]): { betType: BetTypeCode; number: string }[] {
  const seen = new Map<string, { betType: BetTypeCode; number: string }>();
  for (const l of lines) {
    if (BET_TYPES[l.betType] && isValidNumber(l.betType, l.number)) seen.set(keyOf(l.betType, l.number), { betType: l.betType, number: l.number });
  }
  // A fixed order: two bills locking the same numbers always take the locks in the same sequence.
  return [...seen.values()].sort((a, b) => a.betType.localeCompare(b.betType) || a.number.localeCompare(b.number));
}

async function exposureTotals(roundId: number, keys: { betType: BetTypeCode; number: string }[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await q<{ bet_type: string; number: string; total_stake: number }>(
    "SELECT bet_type, number, total_stake FROM exposures WHERE round_id = ? AND bet_type IN (?) AND number IN (?)",
    roundId,
    [...new Set(keys.map((k) => k.betType))],
    [...new Set(keys.map((k) => k.number))],
  );
  return new Map(rows.map((r) => [keyOf(r.bet_type, r.number), r.total_stake]));
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
  const missing = keys.filter((k) => !existing.has(keyOf(k.betType, k.number)));
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
    for (const r of rows) totals.set(keyOf(betType, r.number), r.total_stake);
  }
  return totals;
}

function fingerprintOf(lines: LineQuote[]): string {
  const shape = lines.map((l) => [l.betType, l.number, l.stake, l.ok ? l.segments : l.reason]);
  return createHash("sha1").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

const failQuote = (roundId: number, error: QuoteError, message: string): Quote => ({
  roundId,
  ok: false,
  lines: [],
  totalStake: 0,
  fingerprint: "",
  error,
  message,
});

interface PriceInput {
  /** Messages and bet type names in the request's language. */
  e: Dict["errors"];
  betLabels: Dict["lotto"]["betTypes"];
  round: Round | undefined;
  lotto: Lotto | undefined;
  settings: AllSettings;
  manual: Map<string, ManualLimit>;
  totals: Map<string, number>;
}

/** Price every line against exposure totals and limits. Pure: the caller supplies the data. */
function priceLines(roundId: number, lines: SlipLine[], now: number, { e, betLabels, round, lotto, settings, manual, totals }: PriceInput): Quote {
  const m = e.bet;
  if (!round || !lotto) return failQuote(roundId, "round_not_found", m.roundNotFound);
  const phase = phaseOf(round, now);
  if (phase === "upcoming") return failQuote(roundId, "round_not_open", m.roundNotOpen);
  if (phase !== "open") return failQuote(roundId, "round_closed", m.roundClosed);
  if (lines.length === 0) return failQuote(roundId, "empty", m.empty);

  const configs = new Map(betConfigs(lotto, settings).map((c) => [c.code, c]));
  const limits = billLimits(lotto, settings);
  if (lines.length > limits.maxLines) {
    return failQuote(roundId, "too_many_lines", fmt(m.tooManyLines, { n: limits.maxLines }));
  }

  const running = new Map<string, number>();
  const inBill = new Map<string, number>();

  const priced: LineQuote[] = lines.map((line) => {
    const cfg = configs.get(line.betType);
    const base: LineBase = {
      betType: line.betType,
      number: line.number,
      stake: line.stake,
      baseRate100: cfg?.rate100 ?? 0,
    };
    if (!cfg) {
      return { ...base, ok: false, reason: "unavailable", message: fmt(m.typeUnavailable, { type: BET_TYPES[line.betType] ? betLabels[line.betType].label : m.thisType }) };
    }
    if (!isValidNumber(line.betType, line.number)) {
      return { ...base, ok: false, reason: "invalid", message: fmt(m.digits, { n: cfg.digits }) };
    }
    if (!Number.isInteger(line.stake) || line.stake < cfg.minStake) {
      return { ...base, ok: false, reason: "min", message: fmt(m.minStake, { n: formatNumber(cfg.minStake) }) };
    }
    const key = keyOf(line.betType, line.number);
    const sameNumberInBill = (inBill.get(key) ?? 0) + line.stake;
    if (sameNumberInBill > cfg.maxPerNumber) {
      return { ...base, ok: false, reason: "max", message: fmt(m.maxPerNumber, { n: formatNumber(cfg.maxPerNumber) }) };
    }
    const current = running.get(key) ?? totals.get(key) ?? 0;
    const result = priceStake({
      baseRate100: cfg.rate100,
      profile: cfg.profile,
      manual: manual.get(key) ?? null,
      currentTotal: current,
      stake: line.stake,
    });
    if (!result.ok) {
      const message =
        result.reason === "closed" ? m.numberClosed : result.remaining > 0 ? fmt(m.remaining, { n: formatNumber(result.remaining) }) : m.full;
      return { ...base, ok: false, reason: result.reason, remaining: result.remaining, message };
    }
    running.set(key, current + line.stake);
    inBill.set(key, sameNumberInBill);
    return {
      ...base,
      ok: true,
      segments: result.segments,
      rate100: averageRate100(result.segments),
      potential: payoutOf(result.segments),
      reduced: result.segments.some((s) => s.rate100 < cfg.rate100),
    };
  });

  const totalStake = lines.reduce((sum, l) => sum + (Number.isFinite(l.stake) ? l.stake : 0), 0);
  if (totalStake > limits.maxPerBill) {
    return {
      ...failQuote(roundId, "over_bill_limit", fmt(m.overBill, { n: formatNumber(limits.maxPerBill) })),
      lines: priced,
      totalStake,
    };
  }
  return { roundId, ok: priced.every((l) => l.ok), lines: priced, totalStake, fingerprint: fingerprintOf(priced) };
}

/** Price a slip for review. Reads only; placing re-prices under locks. */
export async function quoteBill(_userId: number, roundId: number, lines: SlipLine[], now = Date.now()): Promise<Quote> {
  const { t } = await serverI18n();
  const e = t.errors;
  const row = await q1<RoundRow>("SELECT * FROM rounds WHERE id = ?", roundId);
  const round = row && toRound(row);
  if (!round) return failQuote(roundId, "round_not_found", e.bet.roundNotFound);
  const [lotto, settings, manual, totals] = await Promise.all([
    getLotto(round.lottoId),
    getSettings(),
    manualLimitsMap(roundId),
    exposureTotals(roundId, priceableKeys(lines)),
  ]);
  return priceLines(roundId, lines, now, { e, betLabels: t.lotto.betTypes, round, lotto, settings, manual, totals });
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
  { expected, acceptChanges = false, now = Date.now(), note }: { expected?: string; acceptChanges?: boolean; now?: number; note?: string } = {},
): Promise<PlaceResult> {
  // Everything that comes from the shared caches is read before the transaction starts.
  const settings = await getSettings();
  const { t } = await serverI18n();
  const e = t.errors;
  const preview = await q1<RoundRow>("SELECT * FROM rounds WHERE id = ?", roundId);
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

      // Read before taking the number locks: everything after the locks should be short.
      const manual = await manualLimitsMap(roundId);
      const keys = round && phaseOf(round, now) === "open" ? priceableKeys(lines) : [];
      const totals = await lockExposures(roundId, keys);
      const missing = keys.filter((k) => !totals.has(keyOf(k.betType, k.number)));
      if (missing.length) {
        // A row the pre-step could not create (very rare race): create it now under the lock.
        await run(
          `INSERT IGNORE INTO exposures (round_id, bet_type, number) VALUES ${missing.map(() => "(?, ?, ?)").join(", ")}`,
          ...missing.flatMap((k) => [roundId, k.betType, k.number]),
        );
        for (const [k, v] of await lockExposures(roundId, missing)) totals.set(k, v);
      }
      const quote = priceLines(roundId, lines, now, { e, betLabels: t.lotto.betTypes, round, lotto, settings, manual, totals });
      if (quote.error === "round_closed" || quote.error === "round_not_open" || quote.error === "round_not_found") {
        refuse({ ok: false, error: "round_closed", message: quote.message ?? e.bet.roundClosed, quote });
      }
      if (quote.error || !quote.ok) {
        refuse({ ok: false, error: "invalid", message: quote.message ?? e.bet.someInvalid, quote });
      }
      if (expected && expected !== quote.fingerprint && !acceptChanges) {
        refuse({ ok: false, error: "rate_changed", message: e.bet.rateChanged, quote });
      }
      const totalSatang = quote.totalStake * 100;
      if (user!.balance < totalSatang) {
        refuse({ ok: false, error: "insufficient_balance", message: fmt(e.bet.insufficient, { amount: formatBaht(totalSatang - user!.balance) }), quote });
      }

      let code = newBillCode();
      let billId = 0;
      for (let attempt = 0; ; attempt++) {
        try {
          billId = (
            await run(
              "INSERT INTO bills (code, user_id, round_id, total_stake, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              code,
              userId,
              roundId,
              totalSatang,
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
        ["bill_id", "round_id", "bet_type", "number", "stake", "segments", "rate100", "potential"],
        okLines.map((l) => [billId, roundId, l.betType, l.number, l.stake, json.str(l.segments), l.rate100, l.potential]),
      );
      const byKey = new Map<string, { betType: string; number: string; stake: number; potential: number }>();
      for (const l of okLines) {
        const k = keyOf(l.betType, l.number);
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
      const balance = user!.balance - totalSatang;
      await run("UPDATE users SET balance = balance - ? WHERE id = ?", totalSatang, userId);
      await run(
        "INSERT INTO transactions (user_id, wallet, type, amount, balance_after, ref, note, created_at) VALUES (?, 'balance', 'bet', ?, ?, ?, ?, ?)",
        userId,
        -totalSatang,
        balance,
        code,
        `${lotto!.shortName} ${roundLabel(round!)}`.slice(0, 255),
        now,
      );
      afterCommit(() => invalidate(`limits:${roundId}`));
      return { ok: true, billId, code, balance, quote };
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
