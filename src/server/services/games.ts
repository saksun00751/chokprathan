import "server-only";
import { collectDebt } from "chokprathan-core/wallet/debt";
import { randomUUID } from "node:crypto";
import { ambUsername, groupOf, productName, userIdOf } from "@/domain/game-products";
import {
  SC,
  adjustBalance,
  adjustBets,
  cancelBets,
  cancelTips,
  placeBets,
  placeTips,
  rollback,
  settleBets,
  toBaht,
  toSatang,
  voidSettled,
  winRewards,
  type GameTxn,
  type Outcome,
  type Snapshot,
  type StatusCode,
  type WireTxn,
} from "@/domain/seamless";
import { dayStartMs } from "chokprathan-core/rules/time";
import { insertMany, json, q, q1, run, tolerateMissingTable, tx } from "@/server/db";
import { ambCurrency, ambGames, ambLogin, ambPrefix, ambProducts, ambReady, type AmbGame } from "@/server/amb";
import { isBlocked } from "./blocklist";
import { getSettings } from "./settings";
import { move } from "./wallet";

/**
 * Game aggregator callbacks, catalog, and launching (rules in src/domain/seamless.ts). Every
 * callback runs in one transaction with the member's row locked, so the balance the provider is told
 * is always the balance that was changed, and concurrent callbacks for one member queue up.
 */

const ENGINE = {
  placeBets,
  settleBets,
  cancelBets,
  adjustBets,
  rollback,
  winRewards,
  placeTips,
  cancelTips,
  voidSettled,
  adjustBalance,
} satisfies Record<string, (s: Snapshot, t: WireTxn[]) => Outcome>;

export type Callback = keyof typeof ENGINE | "checkBalance";
const CALLBACKS = new Set<string>(["checkBalance", ...Object.keys(ENGINE)]);
export const isCallback = (v: string): v is Callback => CALLBACKS.has(v);

const NOT_MIGRATED = new Set([1146, 1054]);
const notMigrated = (error: unknown) => NOT_MIGRATED.has((error as { errno?: number }).errno ?? 0);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 255) => (typeof v === "string" ? v.slice(0, max) : undefined);
const money = (v: unknown) => (v === undefined || v === null ? undefined : typeof v === "number" && Number.isFinite(v) ? toSatang(v) : Number.NaN);

/** The callback's transactions with amounts in satang, or null when the list is unusable. */
function parseTxns(raw: unknown): WireTxn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const out: WireTxn[] = [];
  for (const t of raw) {
    if (!isRecord(t)) return null;
    out.push({
      id: str(t.id, 120),
      refId: str(t.refId, 120),
      roundId: str(t.roundId, 120),
      gameCode: str(t.gameCode, 120),
      playInfo: str(t.playInfo),
      status: str(t.status, 20),
      transactionType: str(t.transactionType, 20),
      betAmount: money(t.betAmount),
      payoutAmount: money(t.payoutAmount),
      amount: money(t.amount),
      isSingleState: t.isSingleState === true,
      skipBalanceUpdate: t.skipBalanceUpdate === true,
    });
  }
  return out;
}

/** Callbacks that put new money into play: refused for suspended, closed, or blocked members. */
const takesNewMoney = (action: Callback, txns: WireTxn[]) =>
  action === "placeBets" || action === "placeTips" || (action === "adjustBalance" && txns.some((t) => t.status === "DEBIT"));

type UserRow = {
  id: number;
  role: string;
  status: string;
  balance: number;
  phone: string | null;
  name: string;
  bank_code: string | null;
  bank_account: string | null;
  bank_name: string | null;
};

type TxnRow = {
  txn_id: string;
  round_id: string | null;
  game_code: string | null;
  play_info: string | null;
  status: GameTxn["status"];
  kind: GameTxn["kind"];
  bet: number;
  debited: number;
  payout: number;
  credited: number;
};

/** The member's stored transactions this callback names: by id, and every one of the rounds it names. */
async function snapshotFor(userId: number, productId: string, txns: WireTxn[], balance: number): Promise<Snapshot> {
  const ids = [...new Set(txns.map((t) => t.refId ?? t.id).filter((v): v is string => !!v))];
  const rounds = [...new Set(txns.map((t) => t.roundId).filter((v): v is string => !!v))];
  const clauses: string[] = [];
  const args: unknown[] = [productId, userId];
  if (ids.length) {
    clauses.push(`txn_id IN (${ids.map(() => "?").join(", ")})`);
    args.push(...ids);
  }
  if (rounds.length) {
    clauses.push(`round_id IN (${rounds.map(() => "?").join(", ")})`);
    args.push(...rounds);
  }
  const rows = clauses.length
    ? await q<TxnRow>(
        `SELECT txn_id, round_id, game_code, play_info, status, kind, bet, debited, payout, credited FROM game_txns
         WHERE product_id = ? AND user_id = ? AND (${clauses.join(" OR ")}) ORDER BY id FOR UPDATE`,
        ...args,
      )
    : [];
  return {
    balance,
    txns: new Map(
      rows.map((r) => [
        r.txn_id,
        {
          txnId: r.txn_id,
          roundId: r.round_id,
          gameCode: r.game_code,
          playInfo: r.play_info,
          status: r.status,
          kind: r.kind,
          bet: Number(r.bet),
          debited: Number(r.debited),
          payout: Number(r.payout),
          credited: Number(r.credited),
        },
      ]),
    ),
  };
}

class Collision extends Error {}

async function persist(userId: number, productId: string, snap: Snapshot, out: Outcome, requestId: string | null, now: number) {
  for (const c of out.changes) {
    if (snap.txns.has(c.txnId)) {
      await run(
        "UPDATE game_txns SET status = ?, bet = ?, debited = ?, payout = ?, credited = ?, updated_at = ? WHERE product_id = ? AND txn_id = ? AND user_id = ?",
        c.status,
        c.bet,
        c.debited,
        c.payout,
        c.credited,
        now,
        productId,
        c.txnId,
        userId,
      );
    } else {
      try {
        await run(
          `INSERT INTO game_txns (user_id, product_id, txn_id, round_id, game_code, play_info, status, kind, bet, debited, payout, credited, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          userId,
          productId,
          c.txnId,
          c.roundId,
          c.gameCode,
          c.playInfo,
          c.status,
          c.kind,
          c.bet,
          c.debited,
          c.payout,
          c.credited,
          now,
          now,
        );
      } catch (error) {
        // The same transaction id already belongs to another member: never touch theirs.
        if ((error as { errno?: number }).errno === 1062) throw new Collision();
        throw error;
      }
    }
  }
  if (out.balanceAfter !== out.balanceBefore) await run("UPDATE users SET balance = ? WHERE id = ?", out.balanceAfter, userId);
  // Stakes count toward the turnover a promotion bonus requires, as lottery bets do.
  if (out.wagered > 0) await run("UPDATE users SET turnover_required = GREATEST(0, turnover_required - ?) WHERE id = ?", out.wagered, userId);
  let running = out.balanceBefore;
  const rows = out.moves.map((m) => {
    running += m.amount;
    return [userId, productId, m.txnId, m.action, m.amount, m.shortfall, running, requestId, now];
  });
  if (rows.length)
    await insertMany("game_moves", ["user_id", "product_id", "txn_id", "action", "amount", "shortfall", "balance_after", "request_id", "created_at"], rows);
}

/**
 * Satang of debt repayments that came out of the credits of these transactions and have not been put
 * back yet. A collection is written by the same callback as its credit, so both carry its time.
 */
async function repaidFromCredits(userId: number, productId: string, txnIds: string[]): Promise<number> {
  const calls = (
    await q<{ at: number }>("SELECT DISTINCT created_at AS at FROM game_moves WHERE user_id = ? AND product_id = ? AND txn_id IN (?) AND amount > 0", userId, productId, txnIds)
  ).map((r) => r.at);
  if (calls.length === 0) return 0;
  const repaid = await q1<{ n: number | string | null }>(
    "SELECT -SUM(amount) AS n FROM transactions WHERE user_id = ? AND type = 'debt_repay' AND created_at IN (?)",
    userId,
    calls,
  );
  const returned = await q1<{ n: number | string | null }>(
    `SELECT SUM(shortfall) AS n FROM game_moves WHERE user_id = ? AND shortfall > 0 AND txn_id IN
       (SELECT txn_id FROM game_moves WHERE user_id = ? AND created_at IN (?) AND amount > 0)`,
    userId,
    userId,
    calls,
  );
  return Math.max(0, Number(repaid?.n ?? 0) - Number(returned?.n ?? 0));
}

/** Owe again what was repaid with money the provider has now taken back, latest debt first. */
async function restoreDebt(userId: number, amount: number) {
  const debts = await q<{ id: number; paid: number | string }>(
    `SELECT id, amount - outstanding - written_off AS paid FROM member_debts
     WHERE user_id = ? AND amount - outstanding - written_off > 0 ORDER BY id DESC FOR UPDATE`,
    userId,
  );
  let left = amount;
  for (const debt of debts) {
    const part = Math.min(left, Number(debt.paid));
    if (part <= 0) break;
    left -= part;
    await run("UPDATE member_debts SET outstanding = outstanding + ? WHERE id = ?", part, debt.id);
  }
}

/** Handle one aggregator callback; always answers with a status code the aggregator understands. */
export async function handleCallback(action: Callback, body: unknown, now = Date.now()): Promise<Record<string, unknown>> {
  const b = isRecord(body) ? body : {};
  const productId = str(b.productId, 40) ?? "";
  const currency = str(b.currency, 8) ?? "";
  const username = str(b.username, 40) ?? "";
  const reply = (statusCode: StatusCode, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    statusCode,
    timestampMillis: Date.now(),
    productId,
    currency: currency || ambCurrency(),
    username,
    ...extra,
  });
  if (!/^[A-Za-z0-9_]{1,40}$/.test(productId)) return reply(SC.forbidden);
  if (currency && currency !== ambCurrency()) return reply(SC.forbidden);
  const userId = userIdOf(ambPrefix(), username);
  if (userId === null) return reply(SC.userNotFound);

  try {
    if (action === "checkBalance") {
      const u = await q1<{ balance: number; role: string }>("SELECT balance, role FROM users WHERE id = ?", userId);
      if (!u || u.role !== "member") return reply(SC.userNotFound);
      return reply(SC.ok, { balance: toBaht(Number(u.balance)) });
    }
    const txns = parseTxns(b.txns);
    if (!txns) return reply(SC.forbidden);
    const requestId = str(b.id, 80) ?? null;
    return await tx(async () => {
      const u = await q1<UserRow>(
        "SELECT id, role, status, balance, phone, name, bank_code, bank_account, bank_name FROM users WHERE id = ? FOR UPDATE",
        userId,
      );
      if (!u || u.role !== "member") return reply(SC.userNotFound);
      const balance = Number(u.balance);
      if (takesNewMoney(action, txns)) {
        const blocked = await isBlocked({ phone: u.phone, bankCode: u.bank_code, bankAccount: u.bank_account, name: u.name, bankName: u.bank_name });
        if (u.status !== "active" || blocked) return reply(SC.forbidden, { balanceBefore: toBaht(balance), balanceAfter: toBaht(balance) });
      }
      const snap = await snapshotFor(userId, productId, txns, balance);
      const out = ENGINE[action](snap, txns);
      if (out.code === SC.ok) {
        // Money taken back that is no longer there may have gone to a debt. Counted before this
        // callback records its own shortfall.
        const short = out.moves.filter((m) => m.shortfall > 0);
        const repaid = short.length ? await repaidFromCredits(userId, productId, short.map((m) => m.txnId)) : 0;
        await persist(userId, productId, snap, out, requestId, now);
        const restore = Math.min(repaid, short.reduce((sum, m) => sum + m.shortfall, 0));
        if (restore > 0) await restoreDebt(userId, restore);
        // New money repays what is owed in this same transaction, so a win is never kept by a
        // failed second step. The provider is still told its own figures, before collection.
        const credited = out.balanceAfter - out.balanceBefore;
        if (credited > 0) await collectDebt({ q, q1, run }, userId, "balance", credited, now);
      }
      return reply(out.code, { balanceBefore: toBaht(out.balanceBefore), balanceAfter: toBaht(out.balanceAfter) });
    });
  } catch (error) {
    if (error instanceof Collision) return reply(SC.duplicate);
    if (!notMigrated(error)) console.error("[games] callback failed:", action, error instanceof Error ? error.message : error);
    return reply(SC.internal);
  }
}

/* ---------- catalog ---------- */

const nameOf = (g: AmbGame) => (g.name || g.locale?.en || g.locale?.EN || g.locale?.th || g.locale?.TH || g.code).slice(0, 160);
const namesOf = (g: AmbGame) => {
  const l = g.locale ?? {};
  const pick = (k: string) => (typeof l[k] === "string" ? l[k] : typeof l[k.toUpperCase()] === "string" ? l[k.toUpperCase()] : undefined);
  const out = { th: pick("th"), en: pick("en"), cn: pick("cn") };
  return out.th || out.en || out.cn ? json.str(out) : null;
};

/** Replace one product's games with what the aggregator lists now. */
async function storeGames(productId: string, games: AmbGame[], now: number) {
  const group = groupOf(productId, games[0]?.type ?? games[0]?.category);
  await tx(async () => {
    await run("DELETE FROM game_catalog WHERE product_id = ?", productId);
    const seen = new Set<string>();
    const rows = games
      .filter((g) => !seen.has(g.code) && seen.add(g.code))
      .map((g, i) => [
        productId,
        g.code,
        nameOf(g),
        namesOf(g),
        (g.type ?? g.category ?? "").slice(0, 30) || null,
        typeof g.img === "string" && /^https:\/\//.test(g.img) ? g.img.slice(0, 500) : null,
        Number.isInteger(g.rank) ? g.rank! : i + 1,
      ]);
    if (rows.length) await insertMany("game_catalog", ["product_id", "code", "name", "names", "type", "img", "rank_no"], rows);
    await run("UPDATE game_products SET games = ?, grp = ?, synced_at = ? WHERE product_id = ?", rows.length, group, now, productId);
  });
}

/** Pull the products and games this agent may offer. Products staff switched off stay off. */
export async function syncCatalog(now = Date.now()): Promise<{ products: number; games: number; failed: string[] }> {
  const ids = await ambProducts();
  for (const id of ids) {
    await run(
      `INSERT INTO game_products (product_id, name, grp, available, synced_at) VALUES (?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), available = 1, synced_at = VALUES(synced_at)`,
      id,
      productName(id),
      groupOf(id),
      now,
    );
  }
  if (ids.length) await run(`UPDATE game_products SET available = 0 WHERE product_id NOT IN (${ids.map(() => "?").join(", ")})`, ...ids);
  const failed: string[] = [];
  let games = 0;
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(
      ids.slice(i, i + 4).map(async (id) => {
        try {
          const list = await ambGames(id);
          await storeGames(id, list, now);
          games += list.length;
        } catch (error) {
          failed.push(id);
          console.error("[games] catalog sync failed for", id, error instanceof Error ? error.message : error);
        }
      }),
    );
  }
  return { products: ids.length, games, failed };
}

/* ---------- launching ---------- */

/** The aggregator's languages; Lao and Khmer fall back to English. */
const LANGUAGE: Record<string, string> = { th: "th", en: "en", my: "my", lo: "en", km: "en" };

export type LaunchError = "off" | "notFound" | "blocked" | "failed";

/** A game URL for a member, or why there is none. */
export async function launchGame(
  userId: number,
  productId: string,
  gameCode: string,
  mobile: boolean,
  lang: string,
): Promise<{ ok: true; url: string } | { ok: false; error: LaunchError }> {
  if (!ambReady()) return { ok: false, error: "off" };
  const [product, game, user] = await Promise.all([
    q1<{ enabled: number; available: number }>("SELECT enabled, available FROM game_products WHERE product_id = ?", productId),
    q1<{ code: string }>("SELECT code FROM game_catalog WHERE product_id = ? AND code = ?", productId, gameCode),
    q1<UserRow>("SELECT id, role, status, balance, phone, name, bank_code, bank_account, bank_name FROM users WHERE id = ?", userId),
  ]);
  if (!product || product.enabled !== 1 || product.available !== 1 || !game) return { ok: false, error: "notFound" };
  if (!user || user.role !== "member" || user.status !== "active") return { ok: false, error: "blocked" };
  if (await isBlocked({ phone: user.phone, bankCode: user.bank_code, bankAccount: user.bank_account, name: user.name, bankName: user.bank_name }))
    return { ok: false, error: "blocked" };
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  try {
    const url = await ambLogin({
      username: ambUsername(ambPrefix(), userId),
      productId,
      gameCode,
      isMobileLogin: mobile,
      sessionToken: randomUUID(),
      language: LANGUAGE[lang] ?? "en",
      callbackUrl: site ? `${site}/games` : undefined,
    });
    return { ok: true, url };
  } catch (error) {
    console.error("[games] launch failed:", productId, error instanceof Error ? error.message : error);
    return { ok: false, error: "failed" };
  }
}

/* ---------- daily close: cashback on game losses ---------- */

/**
 * Close one Bangkok day of games: each member's settled stakes and payouts that day, and cashback
 * at the site's rate on the net loss, paid into the cashback wallet like lottery cashback. Counted
 * on the day a bet settled. Tips and fishing deposits/withdrawals are not bets and earn nothing.
 * Safe to repeat: a member is paid once per day (primary key), the day is marked done at the end.
 */
export async function closeGameDay(day: string, now = Date.now()): Promise<number> {
  return tolerateMissingTable(async () => {
    if (await q1("SELECT 1 FROM game_days WHERE day_key = ?", day)) return 0;
    const start = dayStartMs(day);
    const rows = await q<{ user_id: number; bets: number; paid: number }>(
      `SELECT user_id,
              SUM(CASE WHEN kind = 'bet' THEN debited ELSE 0 END) AS bets,
              SUM(credited) AS paid
       FROM game_txns
       WHERE updated_at >= ? AND updated_at < ? AND status = 'SETTLED' AND kind IN ('bet', 'reward')
       GROUP BY user_id`,
      start,
      start + 86_400_000,
    );
    const { rewards } = await getSettings();
    let members = 0;
    for (const r of rows) {
      const bets = Number(r.bets);
      const paid = Number(r.paid);
      const cashback = Math.floor((Math.max(0, bets - paid) * rewards.cashbackBp) / 10_000);
      const paidNow = await tx(async () => {
        const fresh = await run(
          "INSERT IGNORE INTO game_daily (day_key, user_id, bets, paid, cashback, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          day,
          r.user_id,
          bets,
          paid,
          cashback,
          now,
        );
        if (fresh.changes === 0) return false;
        if (cashback > 0) await move(r.user_id, "cashback", cashback, "cashback_earn", { ref: `GAME-${day}`, note: "คืนยอดเสียเกม", now });
        return true;
      });
      if (paidNow) members++;
    }
    await run("INSERT IGNORE INTO game_days (day_key, members, done_at) VALUES (?, ?, ?)", day, rows.length, now);
    return members;
  }, 0);
}
