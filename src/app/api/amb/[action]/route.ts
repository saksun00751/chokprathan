import { connection } from "next/server";
import { SC } from "@/domain/seamless";
import { ambAllowUnsigned, ambCallbackIps, ambCurrency, ambSignatureKey } from "@/server/amb";
import { signatureOk } from "@/server/amb-signature";
import { clientInfo } from "@/server/request";
import { handleCallback, isCallback } from "@/server/services/games";

/**
 * Seamless-wallet callbacks from the game aggregator: register `<site>/api/amb` as the callback URL
 * in the AMB back office; it calls /checkBalance, /placeBets, /settleBets, ... under it.
 *
 * Every request must carry a valid signature (sapi-signature over the raw body and sapi-timestamp,
 * keyed with AMB_SIGNATURE_KEY). Without that key nothing is accepted. AMB_CALLBACK_IPS limits the
 * callers further; AMB_ALLOW_UNSIGNED=1 accepts unsigned calls only from those IPs.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/amb/[action]">) {
  await connection();
  const { action } = await params;
  const raw = await request.text();
  let body: unknown = null;
  try {
    body = raw.length <= 1_000_000 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const refuse = (statusCode: number) =>
    Response.json(
      {
        id: crypto.randomUUID(),
        statusCode,
        timestampMillis: Date.now(),
        productId: typeof b.productId === "string" ? b.productId : "",
        currency: ambCurrency(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );

  if (!isCallback(action)) return refuse(SC.forbidden);
  const key = ambSignatureKey();
  if (!key) return refuse(SC.forbidden);
  const allowed = ambCallbackIps();
  if (allowed.length > 0) {
    const { ip } = await clientInfo();
    if (!ip || !allowed.includes(ip)) return refuse(SC.forbidden);
  }
  const signed = signatureOk(raw, request.headers.get("sapi-timestamp"), request.headers.get("sapi-signature"), key);
  if (!signed && !ambAllowUnsigned()) return refuse(SC.invalidSignature);
  if (body === null) return refuse(SC.forbidden);

  return Response.json(await handleCallback(action, body), { headers: { "Cache-Control": "no-store" } });
}
