import "server-only";
import { q, run } from "@/server/db";
import { COLL, mongoDb } from "@/server/mongo";

/**
 * Sign-in history and referral-link clicks: written to MongoDB, or to the MariaDB tables
 * `auth_log` / `ref_clicks` when MongoDB is unavailable. Readers merge both, so rows from before
 * the switch and fallback rows stay visible.
 */

const MEMBER_PHONE = /^0\d{9}$/;

/** Staff sign in with a username; a 10-digit phone number is a member. */
export const isStaffIdentifier = (identifier: string | null) => identifier !== null && !MEMBER_PHONE.test(identifier);

/** The newest `limit` rows of two lists that are each sorted newest first. */
export function mergeNewest<T extends { created_at: number }>(a: T[], b: T[], limit: number): T[] {
  return [...a, ...b].sort((x, y) => y.created_at - x.created_at).slice(0, limit);
}

export type SignInCount = { user_id: number; event: string; n: number; last: number };

export function mergeCounts(a: SignInCount[], b: SignInCount[]): SignInCount[] {
  const out = new Map<string, SignInCount>();
  for (const row of [...a, ...b]) {
    const key = `${row.user_id}:${row.event}`;
    const seen = out.get(key);
    out.set(key, seen ? { ...seen, n: seen.n + row.n, last: Math.max(seen.last, row.last) } : { ...row });
  }
  return [...out.values()];
}

/* ---------- sign-ins ---------- */

export interface AuthLogEntry {
  userId: number | null;
  identifier: string | null;
  event: string;
  ip: string | null;
  userAgent: string | null;
  at: number;
}

type AuthDoc = AuthLogEntry & { atDate: Date };

export async function writeAuthLog(e: AuthLogEntry): Promise<void> {
  const identifier = e.identifier?.slice(0, 100) ?? null;
  const userAgent = e.userAgent?.slice(0, 255) ?? null;
  const db = await mongoDb();
  if (db) {
    try {
      await db.collection<AuthDoc>(COLL.authLog).insertOne({ ...e, identifier, userAgent, atDate: new Date(e.at) });
      return;
    } catch {
      // fall through to MariaDB
    }
  }
  await run(
    "INSERT INTO auth_log (user_id, identifier, event, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    e.userId,
    identifier,
    e.event,
    e.ip,
    userAgent,
    e.at,
  );
}

/* ---------- referral-link clicks ---------- */

type ClickDoc = { userId: number; at: number };

export async function writeRefClick(userId: number, at: number): Promise<void> {
  const db = await mongoDb();
  if (db) {
    try {
      await db.collection<ClickDoc>(COLL.refClicks).insertOne({ userId, at });
      return;
    } catch {
      // fall through to MariaDB
    }
  }
  await run("INSERT INTO ref_clicks (user_id, at) VALUES (?, ?)", userId, at);
}

export async function refClickCount(userId: number): Promise<number> {
  const [maria, mongo] = await Promise.all([
    q<{ n: number }>("SELECT COUNT(*) AS n FROM ref_clicks WHERE user_id = ?", userId).then((r) => Number(r[0]?.n ?? 0)),
    (async () => {
      const db = await mongoDb();
      if (!db) return 0;
      try {
        return await db.collection<ClickDoc>(COLL.refClicks).countDocuments({ userId });
      } catch {
        return 0;
      }
    })(),
  ]);
  return maria + mongo;
}
