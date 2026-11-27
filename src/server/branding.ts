import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { cleanBranding, DEFAULT_BRANDING, type Branding } from "@/domain/branding";
import { THEME_CACHE_S } from "@/server/cache-ttl";
import { json, q1 } from "@/server/db";

/**
 * Site name, meta text and images, set in the back office. A change there shows here within
 * THEME_CACHE_S on a fresh load. Falls back to the built-in values when the database cannot be reached.
 *
 * `stale` must stay at least 5 minutes: every page reads this outside Suspense, and Next.js leaves
 * shorter-lived caches out of the App Shell. It only bounds how long an open tab may reuse what it has.
 */
export async function getBranding(): Promise<Branding> {
  "use cache";
  cacheTag("branding");
  cacheLife({ stale: 300, revalidate: THEME_CACHE_S, expire: 86_400 });
  try {
    const row = await q1<{ value: string }>("SELECT `value` FROM settings WHERE `key` = 'branding'");
    return cleanBranding(json.parse<unknown>(row?.value, {}));
  } catch {
    return DEFAULT_BRANDING;
  }
}
