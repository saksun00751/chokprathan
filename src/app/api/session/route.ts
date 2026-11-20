import { cookies } from "next/headers";
import { connection } from "next/server";
import { clientInfo } from "@/server/request";
import { limitLocal } from "@/server/services/ratelimit";
import { SESSION_COOKIE, sessionState } from "@/server/services/auth";
import { expiredSessionCookie } from "@/server/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Is this browser's member session still alive? Polled by SessionWatch so a device that lost its
 * session (the account signed in elsewhere, a password or status change) says so within a minute.
 * Read only: polling never keeps a session alive. A dead cookie is cleared on the way out. The IP of
 * the sign-in that replaced a member is never shown.
 */
export async function GET() {
  await connection();
  // Generous: many members can share one mobile-carrier IP. A refusal just means "ask again later".
  const { ip } = await clientInfo();
  if (!limitLocal(`session-check:${ip ?? "?"}`, 600, 60_000).ok)
    return Response.json({ state: "unknown" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ state: "none" }, { headers: NO_STORE });
  const s = await sessionState(token);
  if (s.state === "active" && s.role === "member") return Response.json({ state: "active" }, { headers: NO_STORE });
  jar.set(expiredSessionCookie());
  if (s.state === "active") return Response.json({ state: "none" }, { headers: NO_STORE });
  return Response.json({ state: "ended", reason: s.reason, at: s.at, ip: null }, { headers: NO_STORE });
}
