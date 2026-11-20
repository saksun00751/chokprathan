import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, matchAcceptLanguage, type Locale } from "@/i18n/config";
import { isRemovedPath, sessionGate } from "@/server/proxy-auth";

/** Must match SESSION_COOKIE in services/auth (the `__Host-` prefix applies over HTTPS in production). */
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-cp_session" : "cp_session";

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

/** Members-only pages send visitors without a session to /login, coming back afterwards. */
function toLogin(request: NextRequest, logicalPath: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(`${logicalPath}${request.nextUrl.search}`)}`;
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
 * Access: members-only paths without a member session go to /login. The back office moved to its
 * own app, so its old addresses (/admin, /console) answer 404 here. Pages and actions still
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

  if (isRemovedPath(logical)) return new NextResponse(null, { status: 404 });
  if (MEMBER_ONLY.some((r) => r.test(logical)) && !request.cookies.get(SESSION_COOKIE)?.value) {
    return toLogin(request, logical);
  }

  // A sign-in page explaining why a session ended: drop that dead cookie so the note shows once.
  // Only after checking the session really is gone, so a crafted link cannot sign anyone out.
  let deadCookie = false;
  if (logical === "/login" && request.nextUrl.searchParams.has("ended")) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token)
      deadCookie = await sessionGate(token)
        .then((g) => g.role === null)
        .catch(() => false);
  }

  const target = prefixed ? null : new URL(`/${locale}${pathname}${search}`, request.url);
  const headers = new Headers(request.headers);
  headers.set("x-locale", locale);
  const response = target ? NextResponse.rewrite(target, { request: { headers } }) : NextResponse.next({ request: { headers } });
  if (cookieLocale !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  if (deadCookie) response.cookies.set(expire(SESSION_COOKIE));
  return response;
}

export const config = {
  // Everything except APIs, uploaded media, Next.js internals, and metadata files.
  matcher: ["/((?!api/|media/|_next/|icon|apple-icon|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml).*)"],
};
