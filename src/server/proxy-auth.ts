import "server-only";
import { createHash } from "node:crypto";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { memo } from "@/server/cache";
import { q1, tolerateMissingTable } from "@/server/db";

/** The back office now lives in its own app: its old addresses on the member site answer 404. */
export const isRemovedPath = (logical: string) => /^\/(admin|console)(\/|$)/.test(logical);

export type SessionGate = { role: "member" } | { role: null; ended: SessionEnd | null };

/**
 * Whether a member session token still works, or why it no longer does (for example, the account
 * signed in on another device). The proxy uses it to drop a dead cookie on /login?ended. Cached for
 * a few seconds per token; every page and action still checks the session itself.
 */
export async function sessionGate(token: string): Promise<SessionGate> {
  if (!token || token.length > 100) return { role: null, ended: null };
  const hash = createHash("sha256").update(token).digest("hex");
  return memo(`proxy:${hash}`, 5_000, async (): Promise<SessionGate> => {
    const row = await q1<{ status: string }>(
      "SELECT u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.role = 'member'",
      hash,
      Date.now(),
    );
    if (row && row.status === "active") return { role: "member" };
    const end = await tolerateMissingTable(() => q1<{ reason: string }>("SELECT reason FROM session_ends WHERE token_hash = ?", hash), undefined);
    return { role: null, ended: endedParam(end?.reason) };
  });
}
