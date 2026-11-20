import "server-only";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import { createHash, randomBytes, randomInt, scrypt as scryptCallback, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { DAY, MINUTE } from "@/domain/time";
import { q, q1, run, tolerateMissingTable, tx } from "@/server/db";
import { writeAuthLog } from "@/server/logs";

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Synchronous variant for seeding only. */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) {
    await scrypt(password, randomBytes(16)); // keep timing similar for unusable hashes
    return false;
  }
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/* ---------- sessions ---------- */

export const SESSION_COOKIE_BASE = "cp_session";
/** `__Host-` pins the cookie to this exact host over HTTPS (no Domain, Path=/, Secure). */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? `__Host-${SESSION_COOKIE_BASE}` : SESSION_COOKIE_BASE;
export const MEMBER_SESSION_TTL = 30 * DAY;
const TOUCH_EVERY = 5 * MINUTE;

/**
 * The `users.role` column keeps both values (it stays in the schema), but this app only signs
 * members in: staff accounts and their sessions live in the back-office app.
 */
export type Role = "member" | "staff";

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/** Recorded reasons; a token nobody recorded anything about simply counts as expired. */
export type StoredEnd = Exclude<SessionEnd, "expired">;

/** How long a device that lost its session can still be told why (a member cookie lives 30 days). */
const END_KEPT = 35 * DAY;

/**
 * End the sessions matching `where`, remembering why for the devices that held them. Until the
 * server restarts onto migration 4 the reason is simply not kept; the sessions end all the same.
 */
async function endSessions(where: string, args: unknown[], reason: StoredEnd, now: number, byIp: string | null = null): Promise<number> {
  await tolerateMissingTable(
    () =>
      run(
        `INSERT IGNORE INTO session_ends (token_hash, user_id, reason, ended_at, by_ip) SELECT token_hash, user_id, ?, ?, ? FROM sessions WHERE ${where}`,
        reason,
        now,
        byIp,
        ...args,
      ),
    undefined,
  );
  return (await run(`DELETE FROM sessions WHERE ${where}`, ...args)).changes;
}

/**
 * Sign a member in on this device. One live session per account: every other session of the
 * account ends here ("replaced"), so a shared or stolen password cannot keep two devices in at once
 * and the device that lost out is told why. The user row lock makes two sign-ins at the same moment
 * take turns: exactly one of them survives.
 */
export async function createSession(userId: number, _role: "member", client: ClientInfo, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + MEMBER_SESSION_TTL;
  const replaced = await tx(async () => {
    await q1("SELECT id FROM users WHERE id = ? FOR UPDATE", userId);
    const ended = await endSessions("user_id = ?", [userId], "replaced", now, client.ip);
    await run(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      sha256(token),
      userId,
      now,
      expiresAt,
      now,
      client.ip,
      client.userAgent?.slice(0, 255) ?? null,
    );
    await run("UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?", now, client.ip, userId);
    return ended;
  });
  return { token, expiresAt, replaced };
}

export interface SessionUser {
  id: number;
  role: Role;
  name: string;
  phone: string | null;
  username: string | null;
  balance: number;
  cashbackBalance: number;
  affiliateBalance: number;
  turnoverRequired: number;
  refCode: string;
  bankCode: string | null;
  bankAccount: string | null;
  bankName: string | null;
  createdAt: number;
}

interface UserRow {
  id: number;
  role: Role;
  status: "active" | "suspended";
  name: string;
  phone: string | null;
  username: string | null;
  balance: number;
  cashback_balance: number;
  affiliate_balance: number;
  turnover_required: number;
  ref_code: string;
  bank_code: string | null;
  bank_account: string | null;
  bank_name: string | null;
  created_at: number;
}

const toSessionUser = (r: UserRow): SessionUser => ({
  id: r.id,
  role: r.role,
  name: r.name,
  phone: r.phone,
  username: r.username,
  balance: r.balance,
  cashbackBalance: r.cashback_balance,
  affiliateBalance: r.affiliate_balance,
  turnoverRequired: r.turnover_required,
  refCode: r.ref_code,
  bankCode: r.bank_code,
  bankAccount: r.bank_account,
  bankName: r.bank_name,
  createdAt: r.created_at,
});

export async function userFromToken(token: string, now = Date.now()): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const row = await q1<UserRow & { last_seen_at: number }>(
    `SELECT u.*, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    hash,
    now,
  );
  if (!row || row.status !== "active") return null;
  if (now - row.last_seen_at > TOUCH_EVERY) await run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now, hash);
  return toSessionUser(row);
}

export async function revokeSession(token: string) {
  await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

/** Sign an account out everywhere (password, 2-step, status or role changes). */
export async function revokeAllSessions(userId: number, reason: StoredEnd = "revoked", now = Date.now()) {
  await endSessions("user_id = ?", [userId], reason, now);
}

/** Why the session behind `token` ended, when that was recorded in the last 35 days. */
export async function sessionEndOf(token: string): Promise<{ reason: StoredEnd; at: number; ip: string | null } | null> {
  if (!token || token.length > 100) return null;
  const row = await tolerateMissingTable(
    () =>
      q1<{ reason: string; ended_at: number; by_ip: string | null }>("SELECT reason, ended_at, by_ip FROM session_ends WHERE token_hash = ?", sha256(token)),
    undefined,
  );
  const reason = endedParam(row?.reason);
  return row && reason && reason !== "expired" ? { reason, at: row.ended_at, ip: row.by_ip } : null;
}

export type SessionState = { state: "active"; role: Role } | { state: "ended"; reason: SessionEnd; at: number | null; ip: string | null };

/**
 * Is the session behind `token` still alive? For the browser's periodic check: it reads only and
 * never counts as activity.
 */
export async function sessionState(token: string, now = Date.now()): Promise<SessionState> {
  const gone = { state: "ended", reason: "expired", at: null, ip: null } as const;
  if (!token || token.length > 100) return gone;
  const hash = sha256(token);
  const row = await q1<{ role: Role; status: string; expires_at: number }>(
    "SELECT u.role, u.status, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    hash,
  );
  if (row) {
    if (row.status !== "active") return { ...gone, reason: "revoked" };
    if (row.expires_at <= now) return gone;
    return { state: "active", role: row.role };
  }
  const end = await sessionEndOf(token);
  return end ? { state: "ended", ...end } : gone;
}

export async function pruneSessions(now = Date.now()) {
  await run("DELETE FROM sessions WHERE expires_at < ?", now);
  await tolerateMissingTable(() => run("DELETE FROM session_ends WHERE ended_at < ?", now - END_KEPT), undefined);
  await run("DELETE FROM login_challenges WHERE expires_at < ?", now);
  await run("DELETE FROM login_attempts WHERE at < ?", now - DAY);
  await run("DELETE FROM otps WHERE expires_at < ?", now - DAY);
}

/* ---------- audit trail of sign-ins ---------- */

export type AuthEvent =
  | "login"
  | "login_failed"
  | "login_locked"
  | "2fa_failed"
  | "logout"
  | "password_changed"
  | "password_reset"
  | "2fa_enabled"
  | "2fa_disabled"
  /** a sign-in that ended the account's session on another device */
  | "session_replaced"
  /** a registration or sign-in refused because a detail is on the blocklist */
  | "register_blocked"
  | "login_blocked";

/** MongoDB when available, else MariaDB (see server/logs). Not part of any transaction: an attempt is logged even if its transaction rolls back. */
export async function authLog(event: AuthEvent, userId: number | null, identifier: string | null, client: ClientInfo, now = Date.now()) {
  await writeAuthLog({ userId, identifier, event, ip: client.ip, userAgent: client.userAgent, at: now });
}

/* ---------- login ---------- */

const LOCK_WINDOW = 15 * MINUTE;
const MAX_FAILURES = 5;
const MAX_IP_FAILURES = 30;

async function lockRemaining(identifier: string, ip: string | null, now: number): Promise<number> {
  const recent = await q<{ at: number }>("SELECT at FROM login_attempts WHERE identifier = ? AND at > ? ORDER BY at", identifier, now - LOCK_WINDOW);
  if (recent.length >= MAX_FAILURES) return recent[recent.length - MAX_FAILURES].at + LOCK_WINDOW - now;
  if (ip) {
    const fromIp = await q1<{ n: number; first: number | null }>(
      "SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts WHERE ip = ? AND at > ?",
      ip,
      now - LOCK_WINDOW,
    );
    if ((fromIp?.n ?? 0) >= MAX_IP_FAILURES) return (fromIp!.first ?? now) + LOCK_WINDOW - now;
  }
  return 0;
}

export type LoginCheck = { ok: true; userId: number; role: "member" } | { ok: false; error: string };

/**
 * Check a member sign-in (by phone). Any other account, staff included, is treated exactly like an
 * unknown one (same error, same failed-attempt count): staff sign in on the back-office app.
 */
export async function checkLogin(identifier: string, password: string, client: ClientInfo, now = Date.now()): Promise<LoginCheck> {
  const id = identifier.trim().slice(0, 100);
  const locked = await lockRemaining(id, client.ip, now);
  const e = await errorsT();
  if (locked > 0) {
    await authLog("login_locked", null, id, client, now);
    return { ok: false, error: fmt(e.auth.locked, { n: Math.ceil(locked / MINUTE) }) };
  }
  const user = await q1<{ id: number; status: string; password_hash: string }>(
    "SELECT id, status, password_hash FROM users WHERE phone = ? AND role = 'member' AND is_simulated = 0",
    id,
  );
  const valid = await verifyPassword(password, user?.password_hash ?? "");
  if (!user || !valid) {
    await run("INSERT INTO login_attempts (identifier, ip, at) VALUES (?, ?, ?)", id, client.ip, now);
    await authLog("login_failed", user?.id ?? null, id, client, now);
    return { ok: false, error: e.auth.badCredentials };
  }
  if (user.status !== "active") return { ok: false, error: e.auth.suspended };
  await run("DELETE FROM login_attempts WHERE identifier = ?", id);
  return { ok: true, userId: user.id, role: "member" };
}

/* ---------- OTP by SMS (shown on screen in demo mode) ---------- */

export type OtpPurpose = "register" | "reset";
const OTP_TTL = 5 * MINUTE;
const OTP_VERIFIED_TTL = 15 * MINUTE;
const OTP_RESEND_GAP = 60_000;

const otpHash = (phone: string, purpose: OtpPurpose, code: string) => sha256(`${phone}:${purpose}:${code}`);

export async function issueOtp(
  phone: string,
  purpose: OtpPurpose,
  now = Date.now(),
): Promise<{ ok: true; code: string; expiresAt: number } | { ok: false; retryAfterMs: number }> {
  const last = await q1<{ sent_at: number }>("SELECT sent_at FROM otps WHERE phone = ? AND purpose = ?", phone, purpose);
  if (last && now - last.sent_at < OTP_RESEND_GAP) return { ok: false, retryAfterMs: last.sent_at + OTP_RESEND_GAP - now };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await run(
    `INSERT INTO otps (phone, purpose, code_hash, expires_at, attempts, sent_at, verified_at) VALUES (?, ?, ?, ?, 0, ?, NULL)
     ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0, sent_at = VALUES(sent_at), verified_at = NULL`,
    phone,
    purpose,
    otpHash(phone, purpose, code),
    now + OTP_TTL,
    now,
  );
  return { ok: true, code, expiresAt: now + OTP_TTL };
}

export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string, now = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await q1<{ code_hash: string; expires_at: number; attempts: number }>(
    "SELECT code_hash, expires_at, attempts FROM otps WHERE phone = ? AND purpose = ?",
    phone,
    purpose,
  );
  const e = await errorsT();
  if (!row) return { ok: false, error: e.auth.otpRequestFirst };
  if (row.attempts >= 5) return { ok: false, error: e.auth.otpTooMany };
  if (now > row.expires_at) return { ok: false, error: e.auth.otpExpired };
  const given = Buffer.from(otpHash(phone, purpose, code.trim()));
  if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
    await run("UPDATE otps SET attempts = attempts + 1 WHERE phone = ? AND purpose = ?", phone, purpose);
    return { ok: false, error: e.auth.otpWrong };
  }
  await run("UPDATE otps SET verified_at = ? WHERE phone = ? AND purpose = ?", now, phone, purpose);
  return { ok: true };
}

async function otpVerified(phone: string, purpose: OtpPurpose, now: number): Promise<boolean> {
  const row = await q1<{ verified_at: number | null }>("SELECT verified_at FROM otps WHERE phone = ? AND purpose = ?", phone, purpose);
  return !!row?.verified_at && now - row.verified_at < OTP_VERIFIED_TTL;
}

/* ---------- registration ---------- */

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export async function newRefCode(): Promise<string> {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += REF_ALPHABET[randomInt(0, REF_ALPHABET.length)];
    if (!(await q1("SELECT 1 FROM users WHERE ref_code = ?", code))) return code;
  }
}

export interface RegisterInput {
  phone: string;
  password: string;
  name: string;
  bankCode: string;
  bankAccount: string;
  bankName: string;
  refCode: string | null;
}

export type RegisterResult = { ok: true; userId: number } | { ok: false; field?: keyof RegisterInput; error: string };

export async function registerMember(input: RegisterInput, { requireOtp }: { requireOtp: boolean }, now = Date.now()): Promise<RegisterResult> {
  const e = await errorsT();
  if (await q1("SELECT 1 FROM users WHERE phone = ?", input.phone)) {
    return { ok: false, field: "phone", error: e.auth.phoneTaken };
  }
  if (requireOtp && !(await otpVerified(input.phone, "register", now))) {
    return { ok: false, field: "phone", error: e.auth.otpAgain };
  }
  if (await q1("SELECT 1 FROM users WHERE bank_code = ? AND bank_account = ?", input.bankCode, input.bankAccount)) {
    return { ok: false, field: "bankAccount", error: e.auth.accountTaken };
  }
  const upline = input.refCode
    ? await q1<{ id: number; upline1_id: number | null }>(
        "SELECT id, upline1_id FROM users WHERE ref_code = ? AND role = 'member' AND status = 'active'",
        input.refCode.trim().toUpperCase().slice(0, 12),
      )
    : undefined;
  const passwordHash = await hashPassword(input.password);

  try {
    const userId = await tx(async () => {
      const id = (
        await run(
          `INSERT INTO users (phone, password_hash, name, bank_code, bank_account, bank_name, ref_code, upline1_id, upline2_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          input.phone,
          passwordHash,
          input.name,
          input.bankCode,
          input.bankAccount,
          input.bankName,
          await newRefCode(),
          upline?.id ?? null,
          upline?.upline1_id ?? null,
          now,
        )
      ).lastId;
      await run("DELETE FROM otps WHERE phone = ? AND purpose = 'register'", input.phone);
      return id;
    });
    return { ok: true, userId };
  } catch (error) {
    // Two sign-ups racing for the same phone or bank account: the unique keys decide.
    if ((error as { errno?: number }).errno === 1062) {
      const msg = String((error as Error).message);
      return msg.includes("users_bank")
        ? { ok: false, field: "bankAccount", error: e.auth.accountTaken }
        : { ok: false, field: "phone", error: e.auth.phoneTaken };
    }
    throw error;
  }
}

export async function resetPassword(
  phone: string,
  password: string,
  { requireOtp }: { requireOtp: boolean },
  now = Date.now(),
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const e = await errorsT();
  if (requireOtp && !(await otpVerified(phone, "reset", now))) return { ok: false, error: e.auth.otpAgainReset };
  const user = await q1<{ id: number }>("SELECT id FROM users WHERE phone = ? AND role = 'member'", phone);
  if (!user) return { ok: false, error: e.auth.noAccountForPhone };
  const hash = await hashPassword(password);
  await tx(async () => {
    await run("UPDATE users SET password_hash = ? WHERE id = ?", hash, user.id);
    await revokeAllSessions(user.id);
    await run("DELETE FROM otps WHERE phone = ? AND purpose = 'reset'", phone);
    await run("DELETE FROM login_attempts WHERE identifier = ?", phone);
  });
  return { ok: true, userId: user.id };
}

export async function changePassword(userId: number, current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = await errorsT();
  const row = await q1<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
  if (!row || !(await verifyPassword(current, row.password_hash))) return { ok: false, error: e.auth.currentWrong };
  if (await verifyPassword(next, row.password_hash)) return { ok: false, error: e.auth.sameAsOld };
  await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), userId);
  return { ok: true };
}
