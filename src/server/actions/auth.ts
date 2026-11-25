"use server";

import { isBlocked, memberIdentity } from "@/server/services/blocklist";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BANKS } from "@/domain/banks";
import type { Dict } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import type { ActionResult } from "@/lib/action";
import { q1 } from "@/server/db";
import { clientInfo } from "@/server/request";
import {
  authLog,
  checkLogin,
  createSession,
  issueOtp,
  registerMember,
  resetPassword,
  revokeSession,
  SESSION_COOKIE,
  userFromToken,
  verifyOtp,
  type OtpPurpose,
} from "@/server/services/auth";
import { limitShared, retryText } from "@/server/services/ratelimit";
import { recordRefClick } from "@/server/services/retention";
import { getSettings } from "@/server/services/settings";
import { clearSessionCookie, setSessionCookie } from "@/server/session";
import { sendSms, smsConfigured } from "@/server/sms";

const REF_COOKIE = "cp_ref";
const PHONE = /^0[689]\d{8}$/;

/** Where a member goes after signing in: a customer-site page, never the login page or the old back-office addresses. */
function safeNext(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  const ok = /^\/(?![/\\])[\w\-./?=&%#]*$/.test(s) && !/^\/(login|admin|console)(?:[/?#]|$)/.test(s);
  return ok ? s.slice(0, 200) : "/";
}

/** How phone verification works right now: real SMS, the code shown on screen (demo), or none. */
async function otpMode(): Promise<"sms" | "screen" | "off"> {
  const { site } = await getSettings();
  if (site.demoMode) return "screen";
  if (site.otpRequired && smsConfigured()) return "sms";
  return "off";
}

export type LoginState = { error?: string; identifier?: string };

async function startSession(userId: number, next: string) {
  const client = await clientInfo();
  const { token, expiresAt, replaced } = await createSession(userId, "member", client);
  await setSessionCookie(token, expiresAt);
  await authLog("login", userId, null, client);
  // One session per account: this sign-in just signed another device out.
  if (replaced > 0) await authLog("session_replaced", userId, null, client);
  redirect(next);
}

/** Customer sign-in (/login): members only. Staff accounts are unknown here and sign in on the back-office app. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "")
    .trim()
    .slice(0, 100);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const next = safeNext(formData.get("next"));
  const e = await errorsT();
  if (!identifier || !password) return { error: e.auth.loginMissing, identifier };

  const client = await clientInfo();
  const burst = await limitShared(`login:ip:${client.ip ?? "?"}`, 40, 10 * 60_000);
  if (!burst.ok) return { error: fmt(e.auth.loginBurst, { wait: retryText(burst.retryAfterMs, e) }), identifier };

  const result = await checkLogin(identifier, password, client, Date.now());
  if (!result.ok) return { error: result.error, identifier };
  // A blocked account, phone, or name cannot sign in (checked after the password, so the blocklist cannot be probed).
  const who = await memberIdentity(result.userId);
  if (who && (await isBlocked(who))) {
    await authLog("login_blocked", result.userId, identifier, client);
    return { error: e.auth.accountBlocked, identifier };
  }
  await startSession(result.userId, next);
  return {};
}

async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const viewer = await userFromToken(token);
    await revokeSession(token);
    if (viewer) await authLog("logout", viewer.id, null, await clientInfo());
  }
  await clearSessionCookie();
}

/** Member sign-out (customer site). */
export async function logoutAction() {
  await signOut();
  redirect("/");
}

/* ---------- registration ---------- */

async function otpThrottle(phone: string, purpose: OtpPurpose): Promise<string | null> {
  const e = await errorsT();
  const client = await clientInfo();
  const perPhone = await limitShared(`otp:${purpose}:${phone}`, 5, 60 * 60_000);
  if (!perPhone.ok) return fmt(e.auth.otpPerPhone, { wait: retryText(perPhone.retryAfterMs, e) });
  const perIp = await limitShared(`otp:ip:${client.ip ?? "?"}`, 15, 60 * 60_000);
  if (!perIp.ok) return fmt(e.auth.otpPerIp, { wait: retryText(perIp.retryAfterMs, e) });
  return null;
}

async function deliverOtp(phone: string, purpose: OtpPurpose, mode: "sms" | "screen"): Promise<ActionResult<{ demoCode: string | null; skip: boolean }>> {
  const throttled = await otpThrottle(phone, purpose);
  if (throttled) return { ok: false, error: throttled };
  const e = await errorsT();
  const otp = await issueOtp(phone, purpose);
  if (!otp.ok) return { ok: false, error: fmt(e.auth.otpWait, { wait: retryText(otp.retryAfterMs, e) }) };
  if (mode === "sms") {
    const sent = await sendSms(phone, fmt(e.auth.smsBody, { code: otp.code }));
    if (!sent.ok) return { ok: false, error: sent.error };
    return { ok: true, data: { demoCode: null, skip: false } };
  }
  return { ok: true, data: { demoCode: otp.code, skip: false } };
}

export async function requestRegisterOtp(phone: string): Promise<ActionResult<{ demoCode: string | null; skip: boolean }>> {
  const e = await errorsT();
  const p = String(phone ?? "").replace(/\D/g, "");
  if (!PHONE.test(p)) return { ok: false, error: e.auth.phoneFormat };
  const { site } = await getSettings();
  if (!site.registrationOpen) return { ok: false, error: e.auth.registrationClosed };
  if (await q1("SELECT 1 FROM users WHERE phone = ?", p)) return { ok: false, error: e.auth.phoneTaken };
  // No SMS for a blocked phone.
  if (await isBlocked({ phone: p, bankCode: null, bankAccount: null, name: null, bankName: null })) return { ok: false, error: e.auth.registerBlocked };
  const mode = await otpMode();
  if (mode === "off") return { ok: true, data: { demoCode: null, skip: true } };
  return deliverOtp(p, "register", mode);
}

export async function verifyRegisterOtp(phone: string, code: string): Promise<ActionResult> {
  const r = await verifyOtp(String(phone ?? "").replace(/\D/g, ""), "register", String(code ?? "").slice(0, 10));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

const registerSchema = (e: Dict["errors"]["auth"]) =>
  z
    .object({
      phone: z.string().regex(PHONE, e.phoneInvalid),
      name: z.string().trim().min(2, e.nameRequired).max(80, e.nameTooLong),
      password: z.string().min(8, e.passwordShort).max(64, e.passwordLong),
      confirm: z.string(),
      bankCode: z.string().refine((c) => BANKS.some((b) => b.code === c), e.pickBank),
      bankAccount: z.string().regex(/^\d{10,15}$/, e.accountDigits),
      bankName: z.string().trim().min(2, e.accountName).max(80),
      refCode: z.string().trim().max(12).optional(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: e.mismatch });

export type RegisterInput = z.input<ReturnType<typeof registerSchema>>;

export async function registerAction(input: RegisterInput): Promise<ActionResult> {
  const e = await errorsT();
  const parsed = registerSchema(e.auth).safeParse({
    ...input,
    phone: input?.phone?.replace(/\D/g, ""),
    bankAccount: input?.bankAccount?.replace(/\D/g, ""),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: e.auth.checkForm, fieldErrors };
  }
  const { site } = await getSettings();
  if (!site.registrationOpen) return { ok: false, error: e.auth.registrationClosed };
  const client = await clientInfo();
  const perIp = await limitShared(`register:ip:${client.ip ?? "?"}`, 5, 60 * 60_000);
  if (!perIp.ok) return { ok: false, error: fmt(e.auth.registerBurst, { wait: retryText(perIp.retryAfterMs, e) }) };

  const v = parsed.data;
  // The same answer whichever detail is blocked, so the form cannot be used to probe the blocklist.
  if (await isBlocked({ phone: v.phone, bankCode: v.bankCode, bankAccount: v.bankAccount, name: v.name, bankName: v.bankName })) {
    await authLog("register_blocked", null, v.phone, client);
    return { ok: false, error: e.auth.registerBlocked };
  }
  const refCode = v.refCode || (await cookies()).get(REF_COOKIE)?.value || null;
  const result = await registerMember({ ...v, refCode }, { requireOtp: (await otpMode()) !== "off" });
  if (!result.ok) {
    return { ok: false, error: result.error, fieldErrors: result.field ? { [result.field]: result.error } : undefined };
  }
  const { token, expiresAt } = await createSession(result.userId, "member", client);
  await setSessionCookie(token, expiresAt);
  await authLog("login", result.userId, v.phone, client);
  (await cookies()).delete(REF_COOKIE);
  return { ok: true };
}

export async function trackReferral(code: string): Promise<void> {
  const clean = String(code ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 12);
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return;
  const jar = await cookies();
  if (jar.get(REF_COOKIE)?.value === clean) return;
  const client = await clientInfo();
  if (!(await limitShared(`ref:ip:${client.ip ?? "?"}`, 30, 60 * 60_000)).ok) return;
  if ((await recordRefClick(clean)) !== null) {
    jar.set(REF_COOKIE, clean, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 3600 });
  }
}

/* ---------- forgot password ---------- */

export async function requestResetOtp(phone: string): Promise<ActionResult<{ demoCode: string | null; skip: boolean }>> {
  const e = await errorsT();
  const p = String(phone ?? "").replace(/\D/g, "");
  if (!PHONE.test(p)) return { ok: false, error: e.auth.phoneDigits };
  const mode = await otpMode();
  if (mode === "off") return { ok: false, error: e.auth.resetOff };
  const member = await q1<{ id: number }>("SELECT id FROM users WHERE phone = ? AND role = 'member'", p);
  // A blocked member is treated like an unknown phone: no SMS, and no clue that the phone is registered.
  const who = member ? await memberIdentity(member.id) : null;
  const exists = !!member && !(who && (await isBlocked(who)));
  // Same answer whether or not the phone is registered, so the form cannot be used to probe members.
  if (!exists) {
    const throttled = await otpThrottle(p, "reset");
    if (throttled) return { ok: false, error: throttled };
    return { ok: true, data: { demoCode: null, skip: false } };
  }
  return deliverOtp(p, "reset", mode);
}

export async function verifyResetOtp(phone: string, code: string): Promise<ActionResult> {
  const r = await verifyOtp(String(phone ?? "").replace(/\D/g, ""), "reset", String(code ?? "").slice(0, 10));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function resetPasswordAction(phone: string, password: string, confirm: string): Promise<ActionResult> {
  const e = await errorsT();
  if (typeof password !== "string" || password.length < 8 || password.length > 64)
    return { ok: false, error: e.auth.passwordShort, fieldErrors: { password: e.auth.passwordShort } };
  if (password !== confirm) return { ok: false, error: e.auth.mismatch, fieldErrors: { confirm: e.auth.mismatch } };
  if ((await otpMode()) === "off") return { ok: false, error: e.auth.resetContact };
  const p = String(phone ?? "").replace(/\D/g, "");
  const r = await resetPassword(p, password, { requireOtp: true });
  if (!r.ok) return { ok: false, error: r.error };
  const client = await clientInfo();
  await authLog("password_reset", r.userId, p, client);
  const who = await memberIdentity(r.userId);
  if (who && (await isBlocked(who))) return { ok: false, error: e.auth.accountBlocked };
  const { token, expiresAt } = await createSession(r.userId, "member", client);
  await setSessionCookie(token, expiresAt);
  return { ok: true };
}
