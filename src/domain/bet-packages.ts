/**
 * What the betting and bill screens need to know about price packages. Pure, shared by the browser and
 * the server. Money rules stay in chokprathan-core; the server prices every slip again.
 */
import { betRules, slipKey, type SlipLine } from "chokprathan-core/rules/quote";
import { discountOf, type RoundConfig } from "chokprathan-core/rules/roundConfig";
import { parseSlipText } from "chokprathan-core/rules/slip";
import type { BetTypeCode } from "chokprathan-core/rules/types";

export const STANDARD_PACKAGE = "standard";

/** Bet types of the chosen package. */
type Offered = ReadonlyMap<BetTypeCode, { digits: number; discountBp: number }>;

/** A package id sent by the browser: undefined when absent, null when it is not one. */
export function parsePackageId(input: unknown): number | undefined | null {
  if (input === undefined) return undefined;
  return typeof input === "number" && Number.isInteger(input) && input > 0 && input <= 2_147_483_647 ? input : null;
}

/** Basis points as the percent a member reads: 1500 → "15". */
export const discountPercent = (bp: number) => String(bp / 100);

/**
 * The rate the next baht on a number gets in a package: the cut percent applies to that package's own
 * rate, rounded down like the pricing engine. null = closed.
 */
export function liveRate(rate100: number, badge: { percent: number | null } | undefined): number | null {
  if (!badge) return rate100;
  return badge.percent === null ? null : Math.floor((rate100 * badge.percent) / 100);
}

/** What a slip costs before cut rates are known: stake in baht, discount and amount to pay in satang. */
export function slipDue(lines: SlipLine[], offered: Offered) {
  let stake = 0;
  let discount = 0;
  for (const l of lines) {
    stake += l.stake;
    const bp = offered.get(l.betType)?.discountBp ?? 0;
    if (Number.isInteger(l.stake) && l.stake > 0 && bp > 0) discount += discountOf(l.stake, bp);
  }
  return { stake, discount, net: stake * 100 - discount };
}

export function unofferedLines<T extends SlipLine>(lines: T[], offered: ReadonlyMap<BetTypeCode, unknown>): T[] {
  return lines.filter((l) => !offered.has(l.betType));
}

/** Append lines whose number is not in the slip yet. A stake already in the slip is never changed. */
export function mergeLines<T extends SlipLine>(have: T[], more: T[]): { lines: T[]; added: number } {
  const seen = new Set(have.map((l) => slipKey(l.betType, l.number)));
  const fresh = more.filter((l) => {
    const key = slipKey(l.betType, l.number);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { lines: fresh.length ? [...have, ...fresh] : have, added: fresh.length };
}

export type PasteReason = "format" | "unoffered" | "closed" | "duplicate";

/**
 * Sort pasted text into lines to add and lines to show back for editing. A text line is taken whole
 * or not at all, so nothing the member typed disappears without being named.
 */
export function planPaste(
  text: string,
  { offered, taken, closed }: { offered: ReadonlyMap<BetTypeCode, unknown>; taken: ReadonlySet<string>; closed: ReadonlySet<string> },
): { add: SlipLine[]; rejected: { line: number; text: string; reason: PasteReason }[] } {
  const unreadable = new Set(parseSlipText(text).errors.map((e) => e.line));
  const add: SlipLine[] = [];
  const rejected: { line: number; text: string; reason: PasteReason }[] = [];
  const used = new Set(taken);
  text.split(/\r?\n/).forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const line = i + 1;
    const reject = (reason: PasteReason) => void rejected.push({ line, text: trimmed, reason });
    if (unreadable.has(line)) return reject("format");
    const entries = parseSlipText(trimmed).lines;
    const keys = entries.map((e) => slipKey(e.betType, e.number));
    if (entries.some((e) => !offered.has(e.betType))) return reject("unoffered");
    if (keys.some((k) => closed.has(k))) return reject("closed");
    if (new Set(keys).size !== keys.length || keys.some((k) => used.has(k))) return reject("duplicate");
    for (const k of keys) used.add(k);
    add.push(...entries);
  });
  return { add, rejected };
}

export type BetWindow = "upcoming" | "open" | "closed";

/** Where a round stands now, for a page that stays open after it was rendered. */
export function betWindow(round: { phase: string; opensAt: number; closesAt: number }, now: number): BetWindow {
  if (round.phase === "resulted" || round.phase === "cancelled") return "closed";
  if (now < round.opensAt) return "upcoming";
  return now < round.closesAt ? "open" : "closed";
}

/** A bill's money in satang, and the name its package had when the bill was priced. */
export function billMoney(bill: { totalPaid: number; discount: number; packageId: number | null }, config: RoundConfig | undefined) {
  const pack = config?.packages.find((p) => p.id === bill.packageId);
  return {
    stake: bill.totalPaid + bill.discount,
    discount: bill.discount,
    paid: bill.totalPaid,
    packageName: pack?.name ?? null,
    standard: pack?.code === STANDARD_PACKAGE,
  };
}

/** Every package of a round with what it pays, in the standard bet type order. */
export function packageRows(config: RoundConfig) {
  return config.packages.map(({ id, code, name }) => ({
    id,
    code,
    name,
    rates: betRules(config, id).map((r) => ({ code: r.code, rate100: r.rate100, discountBp: r.discountBp })),
  }));
}
