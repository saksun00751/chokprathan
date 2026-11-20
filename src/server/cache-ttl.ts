/**
 * TTLs (ms) for memo() keys that the back office writes. invalidate() clears only the process
 * that calls it, so once the back office runs as its own app a change reaches this site only when
 * the key expires here. Why each value is what it is: docs/cache-ttl-audit.md.
 * memo() serves a stale value once and refreshes in the background, so hot keys stay cheap.
 */

/** Settings: rates, risk, bet limits, wallet limits, registration, cancel window. Bet acceptance reads them. */
export const SETTINGS_TTL_MS = 5_000;
/** Lotto catalog: enabled/closed lottos, per-lotto rates and limits. Bet acceptance reads it. */
export const LOTTOS_TTL_MS = 5_000;
/** Lobby snapshot: which rounds are open (cancelled rounds drop out) and rate-cut counts. */
export const LOBBY_TTL_MS = 4_000;
/** Rate-cut / closed-number badges per round (manual limits, risk settings). */
export const ROUND_LIMITS_TTL_MS = 3_000;

/** Every TTL above must stay at or below this (enforced by cache-ttl.test.ts). */
export const SAFETY_TTL_MAX_MS = 5_000;

// Cosmetic: a stale value only changes what is shown, never what is accepted. At most 30 s.
/** Active home banners. */
export const BANNERS_TTL_MS = 10_000;
/** Active promotions and published news. */
export const CONTENT_TTL_MS = 15_000;
/** Game products switched on (launching re-checks the table). */
export const GAME_PRODUCTS_TTL_MS = 30_000;
/** One product's game list. */
export const GAME_CATALOG_TTL_MS = 30_000;
/** Latest results and the Yiki strip. */
export const RESULTS_TTL_MS = 10_000;
/** One lotto's result history. */
export const RESULTS_HISTORY_TTL_MS = 15_000;

export const COSMETIC_TTL_MAX_MS = 30_000;
/** Colour theme (Next "use cache", seconds; 30 is also Next's floor for `stale`): updateTag("theme") is process-local too. */
export const THEME_CACHE_S = 30;
