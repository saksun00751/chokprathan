"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { BET_TYPE_ORDER } from "chokprathan-core/rules/betTypes";
import { MAX_STAKE } from "chokprathan-core/rules/slip";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import { parsePackageId } from "@/domain/bet-packages";
import type { ActionResult } from "@/lib/action";
import { json, q1, run } from "@/server/db";
import { cancelBill, placeBill, quoteBill, type PlaceResult, type Quote } from "@/server/services/bills";
import { limitLocal, retryText } from "@/server/services/ratelimit";
import { getViewer } from "@/server/session";

const lineSchema = z.object({
  betType: z.enum(BET_TYPE_ORDER as [string, ...string[]]),
  number: z.string().regex(/^\d{1,4}$/),
  stake: z.number().int().positive().max(MAX_STAKE),
});
const linesSchema = z.array(lineSchema).min(1).max(500);

type Lines = Parameters<typeof quoteBill>[2];

function parseLines(input: unknown): Lines | null {
  const parsed = linesSchema.safeParse(input);
  return parsed.success ? (parsed.data as Lines) : null;
}

const validRound = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

export async function quoteSlipAction(roundId: number, lines: unknown, packageId?: unknown): Promise<ActionResult<Quote>> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: e.bet.loginFirst };
  if (!validRound(roundId)) return { ok: false, error: e.bet.roundNotFound };
  const limit = limitLocal(`quote:${viewer.id}`, 30, 10_000);
  if (!limit.ok) return { ok: false, error: fmt(e.bet.quoteBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const parsed = parseLines(lines);
  const pack = parsePackageId(packageId);
  if (!parsed || pack === null) return { ok: false, error: e.bet.badLines };
  return { ok: true, data: await quoteBill(viewer.id, roundId, parsed, Date.now(), pack) };
}

export async function placeSlipAction(
  roundId: number,
  lines: unknown,
  opts: { expected?: string; acceptChanges?: boolean; requestId?: string; packageId?: number },
): Promise<ActionResult<PlaceResult>> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: e.bet.loginFirst };
  if (viewer.role !== "member") return { ok: false, error: e.bet.staffCannotBet };
  if (!validRound(roundId)) return { ok: false, error: e.bet.roundNotFound };
  const limit = limitLocal(`bet:${viewer.id}`, 10, 10_000);
  if (!limit.ok) return { ok: false, error: fmt(e.bet.placeBurst, { wait: retryText(limit.retryAfterMs, e) }) };
  const parsed = parseLines(lines);
  // A package that cannot be read is refused: falling back to the standard one would change the price.
  const pack = parsePackageId(opts?.packageId);
  if (!parsed || pack === null) return { ok: false, error: e.bet.badLines };
  const result = await placeBill(viewer.id, roundId, parsed, {
    packageId: pack,
    expected: typeof opts?.expected === "string" ? opts.expected.slice(0, 32) : undefined,
    acceptChanges: opts?.acceptChanges === true,
    requestId: typeof opts?.requestId === "string" && /^[A-Za-z0-9-]{8,40}$/.test(opts.requestId) ? opts.requestId : undefined,
  });
  if (result.ok) refresh();
  return { ok: true, data: result };
}

const CANCEL_MESSAGE = { not_found: "billNotFound", not_pending: "notPending", round_closed: "cancelRoundClosed", window_passed: "windowPassed" } as const;

export async function cancelBillAction(billId: number): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (!Number.isInteger(billId)) return { ok: false, error: e.bet[CANCEL_MESSAGE.not_found] };
  const result = await cancelBill(viewer.id, billId);
  if (!result.ok) return { ok: false, error: e.bet[CANCEL_MESSAGE[result.error]] };
  refresh();
  return { ok: true, message: e.bet.cancelled };
}

const setSchema = (m: { setName: string; setNameLong: string }) =>
  z.object({
    name: z.string().trim().min(1, m.setName).max(40, m.setNameLong),
    items: linesSchema.max(200),
  });

export async function saveNumberSetAction(name: string, items: unknown): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  const parsed = setSchema(e.bet).safeParse({ name, items });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? e.generic.invalid };
  const count = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM number_sets WHERE user_id = ?", viewer.id);
  if ((count?.n ?? 0) >= 50) return { ok: false, error: e.bet.setLimit };
  await run(
    "INSERT INTO number_sets (user_id, name, items, created_at) VALUES (?, ?, ?, ?)",
    viewer.id,
    parsed.data.name,
    json.str(parsed.data.items),
    Date.now(),
  );
  refresh();
  return { ok: true, message: e.bet.setSaved };
}

export async function deleteNumberSetAction(id: number): Promise<ActionResult> {
  const e = await errorsT();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: e.generic.loginFirst };
  if (!Number.isInteger(id)) return { ok: false, error: e.bet.setNotFound };
  await run("DELETE FROM number_sets WHERE id = ? AND user_id = ?", id, viewer.id);
  refresh();
  return { ok: true, message: e.bet.setDeleted };
}
