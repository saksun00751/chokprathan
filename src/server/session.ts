import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Door } from "@/domain/doors";
import type { Permission } from "@/domain/permissions";
import { can, sessionCookieName, sessionEndOf, userFromToken, type SessionUser } from "@/server/services/auth";
import { getSetting } from "@/server/services/settings";

/**
 * Two separate sessions: members sign in on the customer site (/login) and staff on the console
 * (/console), each with its own cookie. The customer site only ever reads the member cookie and the
 * back office only the staff cookie, so a staff session never shows up on the customer site.
 * Both read cookies, so callers must sit inside <Suspense> (Cache Components).
 */
async function sessionUser(door: Door): Promise<SessionUser | null> {
  const token = (await cookies()).get(sessionCookieName(door))?.value;
  if (!token) return null;
  await io(); // the lookup compares expiry with the current time and reads live balances
  const user = await userFromToken(token);
  return user?.role === door ? user : null;
}

/** The signed-in member for this request, or null. Deduplicated per request with React cache. */
export const getViewer = cache((): Promise<SessionUser | null> => sessionUser("member"));

/** The signed-in staff member (console session) for this request, or null. */
export const getStaff = cache((): Promise<SessionUser | null> => sessionUser("staff"));

/**
 * The sign-in page for `door`, coming back to `next`. When this browser still holds a cookie whose
 * session was ended for a recorded reason (usually: the account signed in on another device), the
 * page is told why so it can say so.
 */
export async function doorUrl(door: Door, next: string): Promise<string> {
  const token = (await cookies()).get(sessionCookieName(door))?.value;
  const end = token ? await sessionEndOf(token) : null;
  return `${door === "staff" ? "/console" : "/login"}?next=${encodeURIComponent(next)}${end ? `&ended=${end.reason}` : ""}`;
}

export async function requireViewer(next = "/"): Promise<SessionUser> {
  const viewer = await getViewer();
  if (!viewer) redirect(await doorUrl("member", next));
  return viewer;
}

/**
 * Staff who must still set up 2-step sign-in: the owner can require it for everyone ("ตั้งค่าเว็บ").
 * Until they do, the back office only opens the security page, and every action is refused.
 */
export async function needsTotpSetup(viewer: Pick<SessionUser, "role" | "totpEnabled">): Promise<boolean> {
  return viewer.role === "staff" && !viewer.totpEnabled && (await getSetting("site")).staffTotpRequired;
}

/**
 * A staff member holding `need` (or any staff member when omitted). Without a console session the
 * visitor is sent to the console sign-in; staff without the permission see which permission is
 * missing. Staff who must change their password go there first.
 */
export async function requireStaff(need?: Permission): Promise<SessionUser> {
  const viewer = await getStaff();
  if (!viewer) redirect(await doorUrl("staff", "/admin"));
  if (viewer.mustChangePassword || (await needsTotpSetup(viewer))) redirect("/admin/security");
  if (need && !can(viewer, need)) redirect(`/admin/denied?need=${encodeURIComponent(need)}`);
  return viewer;
}

/** For Server Actions: the staff member when allowed, otherwise null (never redirects). */
export async function staffFor(need: Permission): Promise<SessionUser | null> {
  const viewer = await getStaff();
  if (!viewer || viewer.mustChangePassword || (await needsTotpSetup(viewer))) return null;
  return can(viewer, need) ? viewer : null;
}

export async function setSessionCookie(token: string, expiresAt: number, door: Door) {
  (await cookies()).set(sessionCookieName(door), token, {
    httpOnly: true,
    // Lax, not Strict: staff open back-office links from chat apps and must stay signed in.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/** The attributes a session cookie is set with; a `__Host-` cookie is only cleared by a Secure Set-Cookie. */
export const expiredSessionCookie = (door: Door) => ({
  name: sessionCookieName(door),
  value: "",
  expires: new Date(0),
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

export async function clearSessionCookie(door: Door) {
  (await cookies()).set(expiredSessionCookie(door));
}
