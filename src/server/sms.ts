import "server-only";
import { errorsT } from "@/i18n/server";
import { maskPhone } from "@/domain/banks";

/**
 * Outgoing SMS for OTP codes. Configure with environment variables:
 *   SMS_PROVIDER=thaibulksms  THAIBULKSMS_API_KEY  THAIBULKSMS_API_SECRET  THAIBULKSMS_SENDER
 *   SMS_PROVIDER=log          (development only: prints the message to the server log)
 */
export const smsConfigured = () => {
  const p = process.env.SMS_PROVIDER;
  if (p === "thaibulksms") return !!(process.env.THAIBULKSMS_API_KEY && process.env.THAIBULKSMS_API_SECRET);
  return p === "log" && process.env.NODE_ENV !== "production";
};

export async function sendSms(phone: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = process.env.SMS_PROVIDER;
  if (provider === "log" && process.env.NODE_ENV !== "production") {
    console.info(`[sms] ${maskPhone(phone)}: ${message}`);
    return { ok: true };
  }
  if (provider === "thaibulksms" && smsConfigured()) {
    const auth = Buffer.from(`${process.env.THAIBULKSMS_API_KEY}:${process.env.THAIBULKSMS_API_SECRET}`).toString("base64");
    const body = new URLSearchParams({ msisdn: phone, message });
    if (process.env.THAIBULKSMS_SENDER) body.set("sender", process.env.THAIBULKSMS_SENDER);
    try {
      const res = await fetch("https://api-v2.thaibulksms.com/sms", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      console.error("[sms] provider refused", res.status, (await res.text()).slice(0, 200));
      return { ok: false, error: (await errorsT()).sms.failed };
    } catch (error) {
      console.error("[sms] send failed", error instanceof Error ? error.message : error);
      return { ok: false, error: (await errorsT()).sms.failed };
    }
  }
  return { ok: false, error: (await errorsT()).sms.notConfigured };
}
