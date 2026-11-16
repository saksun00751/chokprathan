import "server-only";

/**
 * The game aggregator (AMB SuperAPI, seamless wallet). Configured only through the environment:
 *   AMB_API_URL        https://test.ambsuperapi.com (staging) or the production URL from AMB
 *   AMB_AGENT          agent username
 *   AMB_API_KEY        API key from the AMB agent profile
 *   AMB_SIGNATURE_KEY  signatureKey from the AMB back office (verifies every callback)
 *   AMB_USER_PREFIX    prefix of members' game usernames (default "cp")
 *   AMB_CURRENCY       default THB
 *   AMB_CALLBACK_IPS   optional comma list: only these IPs may call the callbacks
 *   AMB_ALLOW_UNSIGNED "1" accepts unsigned callbacks, and only from AMB_CALLBACK_IPS
 * Nothing here is ever logged with the key: an AMB 401 echoes it back.
 */

const env = () => ({
  url: (process.env.AMB_API_URL ?? "").trim().replace(/\/+$/, ""),
  agent: (process.env.AMB_AGENT ?? "").trim(),
  key: (process.env.AMB_API_KEY ?? "").trim(),
  signatureKey: (process.env.AMB_SIGNATURE_KEY ?? "").trim(),
  prefix: ((process.env.AMB_USER_PREFIX ?? "cp").toLowerCase().replace(/[^a-z0-9]/g, "") || "cp").slice(0, 8),
  currency: (process.env.AMB_CURRENCY ?? "THB").trim().toUpperCase(),
  callbackIps: (process.env.AMB_CALLBACK_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowUnsigned: process.env.AMB_ALLOW_UNSIGNED === "1",
});

/** Outbound calls (catalog, launching games) are possible. */
export const ambReady = () => {
  const c = env();
  return !!(c.url && c.agent && c.key);
};
export const ambSignatureKey = () => env().signatureKey;
export const ambPrefix = () => env().prefix;
export const ambCurrency = () => env().currency;
export const ambCallbackIps = () => env().callbackIps;
export const ambAllowUnsigned = () => env().allowUnsigned && env().callbackIps.length > 0;
export function ambHost(): string | null {
  try {
    return new URL(env().url).host;
  } catch {
    return null;
  }
}

export class AmbError extends Error {}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = env();
  if (!ambReady()) throw new AmbError("AMB is not configured");
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.agent}:${c.key}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new AmbError(`AMB ${path} unreachable: ${error instanceof Error ? error.name : "error"}`);
  }
  const json = (await res.json().catch(() => null)) as { code?: number; data?: unknown } | null;
  // Only the status codes go into the error: the body of a 401 contains the API key.
  if (!res.ok || !json || json.code !== 0) throw new AmbError(`AMB ${path.split("?")[0]} failed: HTTP ${res.status}, code ${json?.code ?? "-"}`);
  return json.data as T;
}

/** Product ids this agent may offer. */
export async function ambProducts(): Promise<string[]> {
  const data = await call<unknown>("GET", "/seamless/products");
  return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_]{1,40}$/.test(x)) : [];
}

export interface AmbGame {
  code: string;
  name?: string;
  category?: string;
  type?: string;
  img?: string;
  rank?: number;
  locale?: Record<string, string>;
}

/** The games of one product. The docs show the list under data.games; a bare array is accepted too. */
export async function ambGames(productId: string): Promise<AmbGame[]> {
  const data = await call<{ games?: unknown } | unknown[]>("GET", `/seamless/games?productId=${encodeURIComponent(productId)}`);
  const list = Array.isArray(data) ? data : Array.isArray((data as { games?: unknown })?.games) ? ((data as { games: unknown[] }).games ?? []) : [];
  return list.filter((g): g is AmbGame => !!g && typeof (g as AmbGame).code === "string" && (g as AmbGame).code.length <= 120);
}

/** A game URL for a member (the aggregator opens the member on first login). */
export async function ambLogin(input: {
  username: string;
  productId: string;
  gameCode: string;
  isMobileLogin: boolean;
  sessionToken: string;
  language: string;
  callbackUrl?: string;
}): Promise<string> {
  const data = await call<{ url?: unknown }>("POST", "/seamless/logIn", { ...input, currency: env().currency, betLimit: [] });
  const url = typeof data?.url === "string" ? data.url : "";
  if (!/^https:\/\//.test(url)) throw new AmbError("AMB login returned no game URL");
  return url;
}
