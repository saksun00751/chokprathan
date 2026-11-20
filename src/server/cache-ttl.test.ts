import { describe, expect, it } from "vitest";
import * as ttl from "./cache-ttl";

// After the back office moves to its own app, its writes reach this site only when these keys
// expire here (docs/cache-ttl-audit.md). Keep the ones that affect bet acceptance short.
describe("cache TTLs for keys the back office writes", () => {
  it.each([
    ["SETTINGS_TTL_MS", ttl.SETTINGS_TTL_MS],
    ["LOTTOS_TTL_MS", ttl.LOTTOS_TTL_MS],
    ["LOBBY_TTL_MS", ttl.LOBBY_TTL_MS],
    ["ROUND_LIMITS_TTL_MS", ttl.ROUND_LIMITS_TTL_MS],
  ])("%s is at most 5 s", (_name, value) => {
    expect(ttl.SAFETY_TTL_MAX_MS).toBe(5_000);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(5_000);
  });

  it.each([
    ["BANNERS_TTL_MS", ttl.BANNERS_TTL_MS],
    ["CONTENT_TTL_MS", ttl.CONTENT_TTL_MS],
    ["GAME_PRODUCTS_TTL_MS", ttl.GAME_PRODUCTS_TTL_MS],
    ["GAME_CATALOG_TTL_MS", ttl.GAME_CATALOG_TTL_MS],
    ["RESULTS_TTL_MS", ttl.RESULTS_TTL_MS],
    ["RESULTS_HISTORY_TTL_MS", ttl.RESULTS_HISTORY_TTL_MS],
    ["THEME_CACHE_S (as ms)", ttl.THEME_CACHE_S * 1000],
  ])("cosmetic %s is at most 30 s", (_name, value) => {
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(ttl.COSMETIC_TTL_MAX_MS);
  });
});
