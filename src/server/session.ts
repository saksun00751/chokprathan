import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, sessionEndOf, userFromToken, type SessionUser } from "@/server/services/auth";

/**
 * Members sign in on /login and hold one session cookie. The back office (staff, its own session
 * and cookie) lives in a separate app, so this site only ever reads the member cookie.
 * Reads cookies, so callers must sit inside <Suspense> (Cache Components).
 */
async function sessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await io(); // the lookup compares expiry with the current time and reads live balances
  const user = await userFromToken(token);
  return user?.role === "member" ? user : null;
}

/** The signed-in member for this request, or null. Deduplicated per request with React cache. */
export const getViewer = cache((): Promise<SessionUser | null> => sessionUser());

/**
 * The sign-in page, coming back to `next`. When this browser still holds a cookie whose session was
 * ended for a recorded reason (usually: the account signed in on another device), the page is told
 * why so it can say so.
 */
export async function loginUrl(next: string): Promise<string> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const end = token ? await sessionEndOf(token) : null;
  return `/login?next=${encodeURIComponent(next)}${end ? `&ended=${end.reason}` : ""}`;
}

export async function requireViewer(next = "/"): Promise<SessionUser> {
  const viewer = await getViewer();
  if (!viewer) redirect(await loginUrl(next));
  return viewer;
}

export async function setSessionCookie(token: string, expiresAt: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax, not Strict: members open links from chat apps and must stay signed in.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/** The attributes a session cookie is set with; a `__Host-` cookie is only cleared by a Secure Set-Cookie. */
export const expiredSessionCookie = () => ({
  name: SESSION_COOKIE,
  value: "",
  expires: new Date(0),
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

export async function clearSessionCookie() {
  (await cookies()).set(expiredSessionCookie());
}
