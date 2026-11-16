/**
 * Seamless-wallet rules for the game aggregator (AMB SuperAPI): providers move money in the
 * member's main balance through callbacks (bet, settle, cancel, adjust, rollback, reward, tip, void,
 * fishing debit/credit). Pure functions: given the member's balance and the stored transactions a
 * callback refers to, each returns the new balance and what to store. The server runs them inside
 * one database transaction with the member's balance locked.
 *
 * Amounts here are satang (the wire carries baht with decimals; see toSatang/toBaht). Every stored
 * transaction keeps what the provider reported (bet, payout) apart from what really moved
 * (debited, credited), so refunds, rollbacks, and voids undo exactly what happened, never more.
 * Taking money back (rollback, void) never pushes a balance below zero: the rest is recorded as a
 * shortfall for staff to follow up.
 */

export const SC = {
  ok: 0,
  userNotFound: 10001,
  insufficient: 10002,
  txnNotFound: 20001,
  duplicate: 20002,
  invalidToken: 30001,
  invalidSignature: 30002,
  forbidden: 40003,
  internal: 50001,
} as const;
export type StatusCode = (typeof SC)[keyof typeof SC];

export type TxnStatus = "OPEN" | "WAITING" | "SETTLED" | "REFUND" | "REJECT" | "VOID" | "TIPS" | "DEBIT" | "CREDIT";
export type TxnKind = "bet" | "reward" | "tip" | "adjust";

export interface GameTxn {
  txnId: string;
  roundId: string | null;
  gameCode: string | null;
  playInfo: string | null;
  status: TxnStatus;
  kind: TxnKind;
  /** stake the provider reported */
  bet: number;
  /** what was actually taken from the balance */
  debited: number;
  /** payout the provider reported */
  payout: number;
  /** what was actually paid into the balance */
  credited: number;
}

export interface Snapshot {
  /** the member's balance, satang */
  balance: number;
  /** stored transactions the callback refers to (by id, and every transaction of the rounds it names) */
  txns: Map<string, GameTxn>;
}

export interface Move {
  txnId: string;
  action: string;
  /** signed satang actually applied to the balance */
  amount: number;
  /** satang that should have been taken back but the balance did not cover */
  shortfall: number;
}

export interface Outcome {
  code: StatusCode;
  balanceBefore: number;
  balanceAfter: number;
  /** transactions to insert or update */
  changes: GameTxn[];
  moves: Move[];
  /** stake taken from the balance: counts toward promotion turnover */
  wagered: number;
}

/** A callback transaction with its amounts already converted to satang. */
export interface WireTxn {
  id?: string;
  refId?: string;
  roundId?: string;
  gameCode?: string;
  playInfo?: string;
  status?: string;
  betAmount?: number;
  payoutAmount?: number;
  amount?: number;
  isSingleState?: boolean;
  skipBalanceUpdate?: boolean;
  transactionType?: string;
}

export const toSatang = (baht: number) => Math.round(baht * 100);
export const toBaht = (satang: number) => satang / 100;

class Stop extends Error {
  constructor(readonly code: StatusCode) {
    super(String(code));
  }
}

const MAX_AMOUNT = 1_000_000_000_00;

function amt(n: number | undefined): number {
  if (n === undefined) return 0;
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new Stop(SC.forbidden);
  return n;
}

function txnId(t: WireTxn, key: "id" | "refId" = "id"): string {
  const v = t[key];
  if (typeof v !== "string" || v.length === 0 || v.length > 120) throw new Stop(SC.forbidden);
  return v;
}

const isOpen = (t: GameTxn) => t.status === "OPEN" || t.status === "WAITING";
const byRound = (t: WireTxn) => t.transactionType === "BY_ROUND" && !!t.roundId;
const base = (t: WireTxn) => ({ roundId: t.roundId ?? null, gameCode: t.gameCode ?? null, playInfo: t.playInfo?.slice(0, 255) ?? null });

class Work {
  readonly before: number;
  balance: number;
  readonly txns: Map<string, GameTxn>;
  readonly changed = new Map<string, GameTxn>();
  readonly moves: Move[] = [];
  wagered = 0;

  constructor(s: Snapshot) {
    this.before = this.balance = s.balance;
    this.txns = new Map([...s.txns].map(([k, v]) => [k, { ...v }]));
  }

  get = (id: string) => this.txns.get(id);
  round = (roundId: string) => [...this.txns.values()].filter((t) => t.roundId === roundId);

  put(t: GameTxn) {
    this.txns.set(t.txnId, t);
    this.changed.set(t.txnId, t);
  }

  /** Take money the member must have. */
  take(id: string, action: string, amount: number) {
    if (amount <= 0) return;
    if (this.balance < amount) throw new Stop(SC.insufficient);
    this.balance -= amount;
    this.moves.push({ txnId: id, action, amount: -amount, shortfall: 0 });
  }

  give(id: string, action: string, amount: number) {
    if (amount <= 0) return;
    this.balance += amount;
    this.moves.push({ txnId: id, action, amount, shortfall: 0 });
  }

  /** Take money back that the provider says is not the member's: as much as there is. */
  claw(id: string, action: string, amount: number) {
    if (amount <= 0) return;
    const applied = Math.min(amount, this.balance);
    this.balance -= applied;
    this.moves.push({ txnId: id, action, amount: -applied, shortfall: amount - applied });
  }
}

/** Run a callback on a working copy: all of it applies, or (on any refusal) none of it. */
function run(s: Snapshot, fn: (w: Work) => void): Outcome {
  const w = new Work(s);
  try {
    fn(w);
  } catch (error) {
    if (error instanceof Stop) return { code: error.code, balanceBefore: s.balance, balanceAfter: s.balance, changes: [], moves: [], wagered: 0 };
    throw error;
  }
  return { code: SC.ok, balanceBefore: w.before, balanceAfter: w.balance, changes: [...w.changed.values()], moves: w.moves, wagered: w.wagered };
}

export function placeBets(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    const total = txns.reduce((sum, t) => sum + (t.skipBalanceUpdate ? 0 : amt(t.betAmount)), 0);
    if (txns.some((t) => w.get(txnId(t)))) throw new Stop(SC.duplicate);
    if (w.balance < total) throw new Stop(SC.insufficient);
    for (const t of txns) {
      const id = txnId(t);
      if (w.get(id)) throw new Stop(SC.duplicate);
      const bet = amt(t.betAmount);
      const debited = t.skipBalanceUpdate ? 0 : bet;
      w.put({ txnId: id, ...base(t), status: t.status === "WAITING" ? "WAITING" : "OPEN", kind: "bet", bet, debited, payout: 0, credited: 0 });
      w.take(id, "bet", debited);
      w.wagered += debited;
    }
  });
}

export function settleBets(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const id = txnId(t);
      const payout = amt(t.payoutAmount);
      const credited = t.skipBalanceUpdate ? 0 : payout;
      const existing = w.get(id);
      if (existing?.status === "SETTLED") throw new Stop(SC.duplicate);
      if (existing && !isOpen(existing)) throw new Stop(SC.forbidden);
      const roundKnown = byRound(t) && w.round(t.roundId!).length > 0;
      // A round settlement closes every other open bet of the round; the payout is paid once.
      if (byRound(t)) for (const o of w.round(t.roundId!)) if (o.txnId !== id && isOpen(o)) w.put({ ...o, status: "SETTLED" });
      if (existing) {
        w.put({ ...existing, status: "SETTLED", payout, credited });
      } else if (t.isSingleState) {
        // Bet and result in one call (e.g. PG Soft): the stake must be covered first.
        const bet = amt(t.betAmount);
        const debited = t.skipBalanceUpdate ? 0 : bet;
        w.take(id, "bet", debited);
        w.wagered += debited;
        w.put({ txnId: id, ...base(t), status: "SETTLED", kind: "bet", bet, debited, payout, credited });
      } else if (roundKnown) {
        // The round is settled under an id of its own.
        w.put({ txnId: id, ...base(t), status: "SETTLED", kind: "bet", bet: 0, debited: 0, payout, credited });
      } else {
        throw new Stop(SC.txnNotFound);
      }
      w.give(id, "settle", credited);
    }
  });
}

export function cancelBets(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const status = t.status === "REJECT" ? "REJECT" : "REFUND";
      const targets = byRound(t) ? w.round(t.roundId!).filter((x) => x.kind === "bet") : [w.get(txnId(t))].filter((x): x is GameTxn => !!x);
      if (targets.length === 0) throw new Stop(SC.txnNotFound);
      const live = targets.filter(isOpen);
      if (live.length === 0) throw new Stop(targets.some((x) => x.status === "REFUND" || x.status === "REJECT") ? SC.duplicate : SC.forbidden);
      for (const x of live) {
        w.put({ ...x, status });
        w.give(x.txnId, "refund", x.debited);
      }
    }
  });
}

export function adjustBets(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const x = w.get(txnId(t));
      if (!x) throw new Stop(SC.txnNotFound);
      if (!isOpen(x)) throw new Stop(SC.forbidden);
      const bet = amt(t.betAmount);
      // A stake the provider holds itself (nothing was taken) stays with the provider.
      const debited = x.debited === 0 && x.bet > 0 ? 0 : bet;
      const diff = debited - x.debited;
      if (diff > 0) w.take(x.txnId, "adjust", diff);
      else w.give(x.txnId, "adjust", -diff);
      w.wagered += Math.max(0, diff);
      w.put({ ...x, bet, debited });
    }
  });
}

export function rollback(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const targets = byRound(t) ? w.round(t.roundId!) : [w.get(txnId(t))].filter((x): x is GameTxn => !!x);
      if (targets.length === 0) throw new Stop(SC.txnNotFound);
      const live = targets.filter((x) => x.status === "SETTLED" || x.status === "REFUND");
      if (live.length === 0) throw new Stop(targets.some(isOpen) ? SC.duplicate : SC.forbidden);
      for (const x of live) {
        if (x.status === "SETTLED") {
          w.claw(x.txnId, "rollback", x.credited);
          w.put({ ...x, status: x.kind === "reward" ? "VOID" : "OPEN", payout: 0, credited: 0 });
        } else {
          // A refunded stake goes back into play.
          w.claw(x.txnId, "rollback", x.debited);
          w.put({ ...x, status: "OPEN" });
        }
      }
    }
  });
}

export function winRewards(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const id = txnId(t);
      if (w.get(id)) throw new Stop(SC.duplicate);
      const payout = amt(t.payoutAmount);
      w.put({ txnId: id, ...base(t), status: "SETTLED", kind: "reward", bet: amt(t.betAmount), debited: 0, payout, credited: payout });
      w.give(id, "reward", payout);
    }
  });
}

export function placeTips(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const id = txnId(t);
      if (w.get(id)) throw new Stop(SC.duplicate);
      const bet = amt(t.betAmount);
      w.take(id, "tip", bet);
      w.put({ txnId: id, ...base(t), status: "TIPS", kind: "tip", bet, debited: bet, payout: 0, credited: 0 });
    }
  });
}

export function cancelTips(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const x = w.get(txnId(t));
      if (!x) throw new Stop(SC.txnNotFound);
      if (x.kind === "tip" && x.status === "REFUND") throw new Stop(SC.duplicate);
      if (x.kind !== "tip" || x.status !== "TIPS") throw new Stop(SC.forbidden);
      w.give(x.txnId, "tip_refund", x.debited);
      w.put({ ...x, status: "REFUND" });
    }
  });
}

export function voidSettled(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const targets = byRound(t) ? w.round(t.roundId!) : [w.get(txnId(t))].filter((x): x is GameTxn => !!x);
      if (targets.length === 0) throw new Stop(SC.txnNotFound);
      const live = targets.filter((x) => x.status === "SETTLED");
      if (live.length === 0) throw new Stop(targets.some((x) => x.status === "VOID") ? SC.duplicate : SC.forbidden);
      for (const x of live) {
        // Stake back, payout out.
        const delta = x.debited - x.credited;
        if (delta >= 0) w.give(x.txnId, "void", delta);
        else w.claw(x.txnId, "void", -delta);
        w.put({ ...x, status: "VOID" });
      }
    }
  });
}

export function adjustBalance(s: Snapshot, txns: WireTxn[]): Outcome {
  return run(s, (w) => {
    for (const t of txns) {
      const ref = txnId(t, t.refId !== undefined ? "refId" : "id");
      if (w.get(ref)) throw new Stop(SC.duplicate);
      const amount = amt(t.amount);
      if (t.status === "DEBIT") {
        w.take(ref, "debit", amount);
        w.put({
          txnId: ref,
          roundId: null,
          gameCode: null,
          playInfo: null,
          status: "DEBIT",
          kind: "adjust",
          bet: amount,
          debited: amount,
          payout: 0,
          credited: 0,
        });
      } else if (t.status === "CREDIT") {
        w.give(ref, "credit", amount);
        w.put({
          txnId: ref,
          roundId: null,
          gameCode: null,
          playInfo: null,
          status: "CREDIT",
          kind: "adjust",
          bet: 0,
          debited: 0,
          payout: amount,
          credited: amount,
        });
      } else {
        throw new Stop(SC.forbidden);
      }
    }
  });
}
