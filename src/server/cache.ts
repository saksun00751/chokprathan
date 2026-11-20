import "server-only";
import { inTx, outsideTx } from "@/server/db";

/**
 * Tiny in-process cache for hot, shared reads (settings, lotto catalog, lobby, cut rates).
 * Concurrent callers share one in-flight load, so a burst of traffic costs one query.
 * Writers call invalidate() in this process; other processes catch up within the TTL on a busy key,
 * and never later than STALE_BOUND_FACTOR x the TTL (plus one load).
 */
type Entry = { value?: unknown; at: number; gen: number; inflight?: Promise<unknown> };
const entries = ((globalThis as unknown as { __chokprathanCache?: Map<string, Entry> }).__chokprathanCache ??= new Map());

/**
 * How stale a value may still be answered at once: below STALE_BOUND_FACTOR x ttl the caller gets
 * the old value and a background refresh starts; past it the caller waits for a fresh load (shared
 * with any other caller) and sees its error if it fails, as on a cold miss. Without the bound a key
 * nobody read for an hour would hand its first reader an hour-old value. docs/cache-ttl-audit.md
 */
export const STALE_BOUND_FACTOR = 2;

let disabled = false;
/** Tests turn caching off so every read sees the latest write. */
export function setCacheEnabled(on: boolean) {
  disabled = !on;
  entries.clear();
}

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  // Inside a transaction, never wait for a second pool connection while holding row locks: with
  // every connection busy that would starve. Read on the transaction's own connection, uncached.
  if (disabled) return inTx() ? load() : outsideTx(load);
  const now = Date.now();
  let e = entries.get(key);
  if (e && "value" in e && now - e.at < ttlMs) return e.value as T;
  if (e && "value" in e && now - e.at < ttlMs * STALE_BOUND_FACTOR) {
    // Stale but within the bound: answer at once and refresh in the background (stale-while-revalidate).
    if (!e.inflight) void refresh(e, load).catch(() => {});
    return e.value as T;
  }
  if (e?.inflight) return e.inflight as Promise<T>;
  if (inTx()) return load();
  if (!e) {
    e = { at: 0, gen: 0 };
    entries.set(key, e);
  }
  return refresh(e, load);
}

function refresh<T>(entry: Entry, load: () => Promise<T>): Promise<T> {
  const gen = entry.gen;
  // Loads run outside any caller's transaction so they never cache uncommitted rows.
  const p: Promise<T> = outsideTx(load).then(
    (value) => {
      if (entry.gen === gen) {
        entry.value = value;
        entry.at = Date.now();
      }
      if (entry.inflight === p) entry.inflight = undefined;
      return value;
    },
    (error: unknown) => {
      if (entry.inflight === p) entry.inflight = undefined;
      throw error;
    },
  );
  entry.inflight = p;
  if (entries.size > 5000) sweep(Date.now());
  return p;
}

/** Drop cached values whose key starts with any prefix. */
export function invalidate(...prefixes: string[]) {
  for (const [key, e] of entries) {
    if (prefixes.some((p) => key.startsWith(p))) {
      e.gen++;
      delete e.value;
      e.at = 0;
      e.inflight = undefined; // a load started before this write must not be handed out
    }
  }
}

function sweep(now: number) {
  for (const [key, e] of entries) if (!e.inflight && now - e.at > 60_000) entries.delete(key);
}
