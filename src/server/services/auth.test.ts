import { beforeEach, describe, expect, test } from "vitest";
import { q1, run } from "@/server/db";
import { hasTestDb, resetDb } from "@/test/db";
import {
  checkLogin,
  createSession,
  hashPassword,
  issueOtp,
  registerMember,
  revokeAllSessions,
  revokeSession,
  sessionEndOf,
  sessionState,
  userFromToken,
  verifyOtp,
} from "./auth";

const now = Date.UTC(2026, 10, 4, 5, 0);
const client = { ip: "203.0.113.7", userAgent: "vitest" };

async function register(phone: string, refCode: string | null = null) {
  const otp = await issueOtp(phone, "register", now);
  if (!otp.ok) throw new Error("otp");
  expect((await verifyOtp(phone, "register", otp.code, now)).ok).toBe(true);
  const r = await registerMember(
    { phone, password: "secret123", name: "ทดสอบ ระบบ", bankCode: "kbank", bankAccount: `01234${phone.slice(-5)}`, bankName: "ทดสอบ ระบบ", refCode },
    { requireOtp: true },
    now,
  );
  if (!r.ok) throw new Error(r.error);
  return r.userId;
}

describe.skipIf(!hasTestDb)("auth on MariaDB", () => {
  beforeEach(resetDb);

  describe("registration", () => {
    test("requires a verified OTP when OTP is on", async () => {
      await issueOtp("0811111111", "register", now);
      const input = { phone: "0811111111", password: "secret123", name: "ก", bankCode: "kbank", bankAccount: "0123456789", bankName: "ก", refCode: null };
      expect((await registerMember(input, { requireOtp: true }, now)).ok).toBe(false);
      expect((await registerMember(input, { requireOtp: false }, now)).ok).toBe(true);
    });

    test("a wrong OTP is refused, a correct one accepted, and codes are stored hashed", async () => {
      const otp = await issueOtp("0811111111", "register", now);
      if (!otp.ok) throw new Error("otp");
      const wrong = otp.code === "000000" ? "111111" : "000000";
      expect((await verifyOtp("0811111111", "register", wrong, now)).ok).toBe(false);
      expect((await verifyOtp("0811111111", "register", otp.code, now)).ok).toBe(true);
      const row = await q1<{ code_hash: string }>("SELECT code_hash FROM otps WHERE phone = '0811111111'");
      expect(row?.code_hash).not.toContain(otp.code);
    });

    test("a second OTP within a minute is refused", async () => {
      expect((await issueOtp("0811111111", "register", now)).ok).toBe(true);
      expect(await issueOtp("0811111111", "register", now + 10_000)).toMatchObject({ ok: false });
      expect((await issueOtp("0811111111", "register", now + 61_000)).ok).toBe(true);
    });

    test("stores a password hash, never the password", async () => {
      const id = await register("0811111111");
      const row = (await q1<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", id))!;
      expect(row.password_hash).not.toContain("secret123");
      expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    });

    test("a referral code links two upline tiers", async () => {
      const a = await register("0811111111");
      const aCode = (await q1<{ ref_code: string }>("SELECT ref_code FROM users WHERE id = ?", a))!.ref_code;
      const b = await register("0822222222", aCode);
      const bCode = (await q1<{ ref_code: string }>("SELECT ref_code FROM users WHERE id = ?", b))!.ref_code;
      const c = await register("0833333333", bCode);
      expect(await q1("SELECT upline1_id, upline2_id FROM users WHERE id = ?", b)).toEqual({ upline1_id: a, upline2_id: null });
      expect(await q1("SELECT upline1_id, upline2_id FROM users WHERE id = ?", c)).toEqual({ upline1_id: b, upline2_id: a });
    });

    test("the same phone or bank account cannot register twice, even at the same moment", async () => {
      const input = (phone: string) => ({ phone, password: "secret123", name: "ก", bankCode: "scb", bankAccount: "9999999999", bankName: "ก", refCode: null });
      const [a, b] = await Promise.all([
        registerMember(input("0811111111"), { requireOtp: false }, now),
        registerMember(input("0822222222"), { requireOtp: false }, now),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const again = await registerMember({ ...input("0811111111"), bankAccount: "1111111111" }, { requireOtp: false }, now);
      expect(again.ok).toBe(false);
    });
  });

  describe("login", () => {
    test("accepts the right password and refuses a wrong one", async () => {
      await register("0811111111");
      expect((await checkLogin("0811111111", "secret123", client, now)).ok).toBe(true);
      expect((await checkLogin("0811111111", "wrong-pass", client, now)).ok).toBe(false);
      expect(await q1("SELECT event FROM auth_log WHERE event = 'login_failed'")).toEqual({ event: "login_failed" });
    });

    test("a staff row in users cannot sign in as a member", async () => {
      // The member login only knows members, whether the staff row is found by username or by phone.
      const hash = await hashPassword("pw-12345");
      await run(
        "INSERT INTO users (id, username, phone, password_hash, name, role, ref_code, created_at) VALUES (900, 'boss', '0899999999', ?, 'Boss', 'staff', 'ZZZZZZ', 1)",
        hash,
      );
      expect(await checkLogin("boss", "pw-12345", { ip: null, userAgent: null }, now)).toMatchObject({ ok: false });
      expect(await checkLogin("0899999999", "pw-12345", { ip: null, userAgent: null }, now)).toMatchObject({ ok: false });
    });

    test("five failures lock the identifier for 15 minutes", async () => {
      await register("0811111111");
      for (let i = 0; i < 5; i++) await checkLogin("0811111111", "wrong-pass", client, now + i);
      expect((await checkLogin("0811111111", "secret123", client, now + 10)).ok).toBe(false);
      expect((await checkLogin("0811111111", "secret123", client, now + 15 * 60_000 + 10)).ok).toBe(true);
    });
  });

  describe("sessions", () => {
    test("resolve to the user until revoked or expired", async () => {
      const id = await register("0811111111");
      const { token, expiresAt } = await createSession(id, "member", client, now);
      expect((await userFromToken(token, now))?.id).toBe(id);
      expect(await userFromToken(token, expiresAt + 1)).toBeNull();
      await revokeSession(token);
      expect(await userFromToken(token, now)).toBeNull();
    });

    test("a suspended member's session stops working", async () => {
      const id = await register("0811111111");
      const { token } = await createSession(id, "member", client, now);
      await run("UPDATE users SET status = 'suspended' WHERE id = ?", id);
      expect(await userFromToken(token, now)).toBeNull();
    });
  });

  describe("one session per account", () => {
    test("signing in on a second device signs the first one out, and the first is told why", async () => {
      const id = await register("0811111111");
      const first = await createSession(id, "member", client, now);
      expect(first.replaced).toBe(0);
      const second = await createSession(id, "member", { ip: "198.51.100.9", userAgent: "phone" }, now + 60_000);
      expect(second.replaced).toBe(1);
      expect(await userFromToken(first.token, now + 61_000)).toBeNull();
      expect(await userFromToken(second.token, now + 61_000)).toMatchObject({ id });
      expect(await sessionEndOf(first.token)).toEqual({ reason: "replaced", at: now + 60_000, ip: "198.51.100.9" });
      expect(await sessionState(first.token, now + 61_000)).toMatchObject({ state: "ended", reason: "replaced" });
      expect(await sessionState(second.token, now + 61_000)).toEqual({ state: "active", role: "member" });
    });

    test("security sign-outs are recorded with their own reason", async () => {
      const id = await register("0811111111");
      const { token } = await createSession(id, "member", client, now);
      await revokeAllSessions(id, "revoked", now + 1000);
      expect(await sessionState(token, now + 2000)).toMatchObject({ state: "ended", reason: "revoked" });
    });

    test("checking a session never keeps it alive", async () => {
      const id = await register("0811111111");
      const { token } = await createSession(id, "member", client, now);
      for (let m = 30; m <= 90; m += 30) expect((await sessionState(token, now + m * 60_000)).state).toBe("active");
      expect(await q1("SELECT last_seen_at FROM sessions WHERE user_id = ?", id)).toEqual({ last_seen_at: now });
    });

    test("an unknown token simply counts as expired", async () => {
      expect(await sessionState("not-a-real-token", now)).toEqual({ state: "ended", reason: "expired", at: null, ip: null });
    });
  });
});
