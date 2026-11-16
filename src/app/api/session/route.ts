import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Door } from "@/domain/doors";
import { clientInfo } from "@/server/request";
import { limitLocal } from "@/server/services/ratelimit";
import { sessionCookieName, sessionState } from "@/server/services/auth";
import { expiredSessionCookie } from "@/server/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Is this browser's session (member or staff, `?door=`) still alive? Polled by SessionWatch so a
 * device that lost its session (the account signed in elsewhere, a password or status change, a
 * staff session left idle) says so within a minute. Read only: polling never keeps a session alive.
 * A dead cookie is cleared on the way out. Only staff are shown the IP of the sign-in that replaced them.
 */
export async function GET(request: Request) {
  await connection();
  const door: Door = new URL(request.url).searchParams.get("door") === "staff" ? "staff" : "member";
  // Generous: many members can share one mobile-carrier IP. A refusal just means "ask again later".
  const { ip } = await clientInfo();
  if (!limitLocal(`session-check:${ip ?? "?"}`, 600, 60_000).ok)
    return Response.json({ state: "unknown" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });

  const jar = await cookies();
  const token = jar.get(sessionCookieName(door))?.value;
  if (!token) return Response.json({ state: "none" }, { headers: NO_STORE });
  const s = await sessionState(token);
  if (s.state === "active" && s.role === door) return Response.json({ state: "active" }, { headers: NO_STORE });
  jar.set(expiredSessionCookie(door));
  if (s.state === "active") return Response.json({ state: "none" }, { headers: NO_STORE });
  return Response.json({ state: "ended", reason: s.reason, at: s.at, ip: door === "staff" ? s.ip : null }, { headers: NO_STORE });
}
