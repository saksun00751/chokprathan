import "server-only";
import type { Dict } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/format";
import { errorsT } from "@/i18n/server";
import { createHash, randomBytes, randomInt, scrypt as scryptCallback, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Door } from "@/domain/doors";
import { hasPermission, type Permission } from "@/domain/permissions";
import { endedParam, type SessionEnd } from "@/domain/sessions";
import { DAY, HOUR, MINUTE } from "@/domain/time";
import { json, q, q1, run, tolerateMissingTable, tx } from "@/server/db";
import { writeAuthLog } from "@/server/logs";
import { matchTotp } from "@/server/totp";

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
/** Staff sessions live in their own cookie: the customer site never reads it, the console never reads the member one. */
export const STAFF_COOKIE = process.env.NODE_ENV === "production" ? "__Host-cp_staff" : "cp_staff";
export const sessionCookieName = (door: Door) => (door === "staff" ? STAFF_COOKIE : SESSION_COOKIE);
export const MEMBER_SESSION_TTL = 30 * DAY;
export const STAFF_SESSION_TTL = 12 * HOUR;
/** A staff session that sits unused this long is signed out. */
export const STAFF_IDLE_TTL = 2 * HOUR;
const TOUCH_EVERY = 5 * MINUTE;

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
 * Sign an account in on this device. One live session per account, members and staff alike:
 * every other session of the account ends here ("replaced"), so a shared or stolen password cannot
 * keep two devices in at once and the device that lost out is told why. Staff reach this only after
 * the 2-step code, so a password alone can never push the real owner out. The user row lock makes
 * two sign-ins at the same moment take turns: exactly one of them survives.
 */
export async function createSession(userId: number, role: Role, client: ClientInfo, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + (role === "staff" ? STAFF_SESSION_TTL : MEMBER_SESSION_TTL);
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
  /** staff only */
  staffRoleId: number | null;
  staffRoleName: string | null;
  permissions: string[];
  isOwner: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
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
  staff_role_id: number | null;
  totp_enabled: number;
  must_change_password: number;
  role_name: string | null;
  role_permissions: string | null;
  role_is_owner: number | null;
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
  staffRoleId: r.role === "staff" ? r.staff_role_id : null,
  staffRoleName: r.role === "staff" ? r.role_name : null,
  permissions: r.role === "staff" ? json.parse<string[]>(r.role_permissions, []) : [],
  isOwner: r.role === "staff" && r.role_is_owner === 1,
  totpEnabled: r.totp_enabled === 1,
  mustChangePassword: r.must_change_password === 1,
});

export const can = (viewer: Pick<SessionUser, "role" | "permissions"> | null | undefined, need: Permission) =>
  !!viewer && viewer.role === "staff" && hasPermission(viewer.permissions, need);

export async function userFromToken(token: string, now = Date.now()): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const row = await q1<UserRow & { last_seen_at: number }>(
    `SELECT u.*, s.last_seen_at, r.name AS role_name, r.permissions AS role_permissions, r.is_owner AS role_is_owner
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN staff_roles r ON r.id = u.staff_role_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hash,
    now,
  );
  if (!row || row.status !== "active") return null;
  if (row.role === "staff" && now - row.last_seen_at > STAFF_IDLE_TTL) {
    await endSessions("token_hash = ?", [hash], "idle", now);
    return null;
  }
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
 * never counts as activity, so a staff screen left open still signs out when idle.
 */
export async function sessionState(token: string, now = Date.now()): Promise<SessionState> {
  const gone = { state: "ended", reason: "expired", at: null, ip: null } as const;
  if (!token || token.length > 100) return gone;
  const hash = sha256(token);
  const row = await q1<{ role: Role; status: string; expires_at: number; last_seen_at: number }>(
    "SELECT u.role, u.status, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    hash,
  );
  if (row) {
    if (row.status !== "active") return { ...gone, reason: "revoked" };
    if (row.expires_at <= now) return gone;
    if (row.role === "staff" && now - row.last_seen_at > STAFF_IDLE_TTL) {
      await endSessions("token_hash = ?", [hash], "idle", now);
      return { ...gone, reason: "idle", at: now };
    }
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

export type LoginCheck = { ok: true; userId: number; role: Role; needsTotp: boolean } | { ok: false; error: string };

/**
 * Check a sign-in at one door: members by phone on the customer site, staff by username on the
 * console. An account at the wrong door is treated exactly like an unknown one (same error, same
 * failed-attempt count), so neither page reveals that the other kind of account exists.
 */
export async function checkLogin(identifier: string, password: string, client: ClientInfo, now = Date.now(), door: Door = "member"): Promise<LoginCheck> {
  const id = identifier.trim().slice(0, 100);
  const locked = await lockRemaining(id, client.ip, now);
  const e = await errorsT();
  if (locked > 0) {
    await authLog("login_locked", null, id, client, now);
    return { ok: false, error: fmt(e.auth.locked, { n: Math.ceil(locked / MINUTE) }) };
  }
  const user = await q1<{ id: number; role: Role; status: string; password_hash: string; totp_enabled: number }>(
    door === "staff"
      ? "SELECT id, role, status, password_hash, totp_enabled FROM users WHERE username = ? AND role = 'staff'"
      : "SELECT id, role, status, password_hash, totp_enabled FROM users WHERE phone = ? AND role = 'member' AND is_simulated = 0",
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
  return { ok: true, userId: user.id, role: user.role, needsTotp: user.role === "staff" && user.totp_enabled === 1 };
}

/* ---------- two-step sign-in for staff with an authenticator app ---------- */

const CHALLENGE_TTL = 5 * MINUTE;

export async function createLoginChallenge(userId: number, next: string, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  await run(
    "INSERT INTO login_challenges (token_hash, user_id, next_path, attempts, expires_at) VALUES (?, ?, ?, 0, ?)",
    sha256(token),
    userId,
    next.slice(0, 200),
    now + CHALLENGE_TTL,
  );
  return { token, expiresAt: now + CHALLENGE_TTL };
}

export async function completeLoginChallenge(
  token: string,
  code: string,
  client: ClientInfo,
  now = Date.now(),
): Promise<{ ok: true; userId: number; next: string } | { ok: false; error: string; expired?: boolean }> {
  const hash = sha256(token);
  const e = await errorsT();
  return tx(async () => {
    const c = await q1<{ user_id: number; next_path: string; attempts: number; expires_at: number }>(
      "SELECT user_id, next_path, attempts, expires_at FROM login_challenges WHERE token_hash = ? FOR UPDATE",
      hash,
    );
    if (!c || c.expires_at < now) return { ok: false as const, error: e.auth.challengeExpired, expired: true };
    if (c.attempts >= 5) {
      await run("DELETE FROM login_challenges WHERE token_hash = ?", hash);
      return { ok: false as const, error: e.auth.totpTooMany, expired: true };
    }
    const user = await q1<{ totp_secret: string | null; totp_last_step: number | null; status: string }>(
      "SELECT totp_secret, totp_last_step, status FROM users WHERE id = ? FOR UPDATE",
      c.user_id,
    );
    const step = user?.totp_secret ? matchTotp(user.totp_secret, code, now, user.totp_last_step) : null;
    if (!user || user.status !== "active" || step === null) {
      await run("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?", hash);
      await authLog("2fa_failed", c.user_id, null, client, now);
      return { ok: false as const, error: e.auth.totpWrong };
    }
    await run("UPDATE users SET totp_last_step = ? WHERE id = ?", step, c.user_id);
    await run("DELETE FROM login_challenges WHERE token_hash = ?", hash);
    return { ok: true as const, userId: c.user_id, next: c.next_path };
  });
}

/** Turn on 2FA after the staff member proves the app shows the right code. */
export async function enableTotp(userId: number, secret: string, code: string, now = Date.now()): Promise<boolean> {
  const step = matchTotp(secret, code, now);
  if (step === null) return false;
  await run("UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ? AND role = 'staff'", secret, step, userId);
  return true;
}

export async function disableTotp(userId: number) {
  await run("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?", userId);
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
  await run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", await hashPassword(next), userId);
  return { ok: true };
}

/** A password policy staff accounts must meet (members keep the simpler 8+ rule). */
export function staffPasswordProblem(password: string, e: Pick<Dict["errors"], "auth">): string | null {
  if (password.length < 10) return e.auth.staffShort;
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return e.auth.staffMix;
  return null;
}
