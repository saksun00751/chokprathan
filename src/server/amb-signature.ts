import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Callbacks from the game aggregator are signed: sapi-signature = hex HMAC-SHA256, keyed with our
 * signatureKey, of `<raw body>.<sapi-timestamp>`. Compared in constant time on the raw bytes as
 * received (never a re-serialised body).
 */
export function signatureOk(raw: string, timestamp: string | null, signature: string | null, key: string): boolean {
  if (!key || !timestamp || !signature || !/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", key).update(`${raw}.${timestamp}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
