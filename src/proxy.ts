import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, matchAcceptLanguage, type Locale } from "@/i18n/config";
import { sessionGate, type SessionGate } from "@/server/proxy-auth";

/** Must match SESSION_COOKIE / STAFF_COOKIE in services/auth (the `__Host-` prefix applies over HTTPS in production). */
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-cp_session" : "cp_session";
const STAFF_COOKIE = process.env.NODE_ENV === "production" ? "__Host-cp_staff" : "cp_staff";

const MEMBER_ONLY = [
  /^\/lotto\/[^/]+$/,
  /^\/bills(\/|$)/,
  /^\/wallet(\/|$)/,
  /^\/numbersets(\/|$)/,
  /^\/affiliate(\/|$)/,
  /^\/cashback(\/|$)/,
  /^\/vouchers(\/|$)/,
  /^\/account(\/|$)/,
];

/** Clears a session cookie; a `__Host-` cookie only clears with the same Secure, Path=/ attributes. */
const expire = (name: string) => ({
  name,
  value: "",
  expires: new Date(0),
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
});

/**
 * Members sign in on /login, staff on /console: each area sends visitors to its own door, saying
 * why when their session was ended (`ended`, e.g. the account signed in on another device).
 */
function toDoor(request: NextRequest, door: "/login" | "/console", logicalPath: string, ended: string | null = null) {
  const url = request.nextUrl.clone();
  url.pathname = door;
  url.search = `?next=${encodeURIComponent(`${logicalPath}${request.nextUrl.search}`)}${ended ? `&ended=${ended}` : ""}`;
  return NextResponse.redirect(url);
}

/**
 * Every page request passes through here.
 *
 * Language: URLs stay unprefixed (/lotto) and are rewritten internally to /{locale}/lotto, the
 * locale coming from the cp_locale cookie, then Accept-Language, then Thai. A prefixed URL (/en/lotto)
 * also works and remembers its language. The page's language is forwarded to the server in
 * `x-locale` so Server Actions answer in the same language.
 *
 * Access: members-only paths without a member session go to /login; the back office only lets a
 * live staff (console) session through and sends everyone else to /console. Pages and actions still
 * authorise every read and write themselves.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  const prefixed = isLocale(first);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale: Locale = prefixed
    ? (first as Locale)
    : isLocale(cookieLocale)
      ? cookieLocale
      : (matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);
  const logical = prefixed ? pathname.slice(first.length + 1) || "/" : pathname;

  // People guess /admin/login: send them to the real staff door (it forwards signed-in staff to /admin).
  if (/^\/admin\/login(?:\/|$)/.test(logical)) {
    const url = request.nextUrl.clone();
    url.pathname = "/console";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const isAdmin = logical === "/admin" || logical.startsWith("/admin/");
  if (isAdmin) {
    // The back office only reads the console (staff) cookie: no live staff session, back to /console.
    const staffToken = request.cookies.get(STAFF_COOKIE)?.value;
    if (!staffToken) return toDoor(request, "/console", logical);
    let gate: SessionGate;
    try {
      gate = await sessionGate(staffToken);
    } catch {
      return new NextResponse("Service unavailable", { status: 503, headers: { "Retry-After": "5" } });
    }
    if (gate.role !== "staff") {
      const response = toDoor(request, "/console", logical, gate.role === null ? gate.ended : null);
      // The cookie no longer opens anything: drop it.
      response.cookies.set(expire(STAFF_COOKIE));
      return response;
    }
  } else if (MEMBER_ONLY.some((r) => r.test(logical)) && !request.cookies.get(SESSION_COOKIE)?.value) {
    return toDoor(request, "/login", logical);
  }

  // A sign-in page explaining why a session ended: drop that dead cookie so the note shows once.
  // Only after checking the session really is gone, so a crafted link cannot sign anyone out.
  let deadCookie: string | null = null;
  if ((logical === "/login" || logical === "/console") && request.nextUrl.searchParams.has("ended")) {
    const name = logical === "/login" ? SESSION_COOKIE : STAFF_COOKIE;
    const token = request.cookies.get(name)?.value;
    if (token)
      deadCookie = await sessionGate(token)
        .then((g) => (g.role === null ? name : null))
        .catch(() => null);
  }

  const target = prefixed ? null : new URL(`/${locale}${pathname}${search}`, request.url);
  const headers = new Headers(request.headers);
  headers.set("x-locale", locale);
  const response = target ? NextResponse.rewrite(target, { request: { headers } }) : NextResponse.next({ request: { headers } });
  if (cookieLocale !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  if (deadCookie) response.cookies.set(expire(deadCookie));
  return response;
}

export const config = {
  // Everything except APIs, uploaded media, Next.js internals, and metadata files.
  matcher: ["/((?!api/|media/|_next/|icon|apple-icon|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml).*)"],
};
