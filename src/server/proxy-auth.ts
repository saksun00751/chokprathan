import "server-only";
import { createHash } from "node:crypto";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { memo } from "@/server/cache";
import { q1, tolerateMissingTable } from "@/server/db";

export type SessionGate = { role: "staff" | "member" } | { role: null; ended: SessionEnd | null };

/**
 * Role behind a session token, for the proxy's back-office gate, or why it no longer works (for
 * example, the account signed in on another device). Cached for a few seconds per token so browsing
 * the back office costs almost nothing; every page and action still checks the session and
 * permissions itself.
 */
export async function sessionGate(token: string): Promise<SessionGate> {
  if (!token || token.length > 100) return { role: null, ended: null };
  const hash = createHash("sha256").update(token).digest("hex");
  return memo(`proxy:${hash}`, 5_000, async (): Promise<SessionGate> => {
    const row = await q1<{ role: "staff" | "member"; status: string }>(
      "SELECT u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
      hash,
      Date.now(),
    );
    if (row && row.status === "active") return { role: row.role };
    const end = await tolerateMissingTable(() => q1<{ reason: string }>("SELECT reason FROM session_ends WHERE token_hash = ?", hash), undefined);
    return { role: null, ended: endedParam(end?.reason) };
  });
}
