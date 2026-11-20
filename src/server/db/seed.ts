import "server-only";
import { createHash } from "node:crypto";
import { BET_TYPES, betTypesFor } from "@/domain/betTypes";
import { DAY, HOUR, MINUTE } from "@/domain/time";
import type { BetTypeCode, ResultFormat, RoundResult } from "@/domain/types";
import { deriveResult } from "@/domain/match";
import { DEFAULT_SITE, DEFAULT_WALLET, LOTTO_CATALOG } from "@/server/catalog";
import { hashPasswordSync } from "@/server/services/auth";
import { placeBill, type SlipLine } from "@/server/services/bills";
import { approveDeposit, approveWithdrawal, createDeposit, requestWithdrawal } from "@/server/services/finance";
import { ensureRounds, randomResult, setResult } from "@/server/services/rounds";
import { getSettings, setSetting } from "@/server/services/settings";
import { BANNER_I18N, PROMO_I18N } from "./content-i18n";
import { DEFAULT_BANNERS, DEFAULT_GAMES, DEFAULT_PROMOTIONS } from "./defaults";
import { insertMany, json, q, q1, run, type SqlValue } from "./index";

export type InstallMode = "production" | "staging";

const empty = async (table: string) => !(await q1(`SELECT 1 FROM ${table} LIMIT 1`));

/**
 * What every install needs: the lotto catalog, home banners, promotions (switched off in
 * production until the operator reviews them) and the game lobby placeholders. Only fills tables
 * that are empty, so it is safe to run again. Staff roles and the first owner account belong to
 * the back-office app (`npm run db -- create-owner` there).
 */
export async function seedEssentials({ mode, now = Date.now() }: { mode: InstallMode; now?: number }) {
  const created: string[] = [];
  if (await empty("lottos")) {
    await insertMany(
      "lottos",
      ["slug", "name", "short_name", "grp", "format", "schedule", "result_delay_min", "auto_result", "flag", "sort", "rates", "limits", "risk", "updated_at"],
      LOTTO_CATALOG.map((e, i) => [
        e.slug,
        e.name,
        e.short,
        e.grp,
        e.format,
        json.str(e.schedule),
        e.delay,
        // Real draws come from their official source; only the house game draws itself in production.
        (mode === "production" ? e.grp === "yiki" : e.auto) ? 1 : 0,
        e.flag,
        i,
        "{}",
        "{}",
        "{}",
        now,
      ]),
    );
    created.push("lotto catalog");
  }
  if (await empty("banners")) {
    await insertMany(
      "banners",
      ["tag", "title", "subtitle", "cta_label", "cta_href", "art", "tone", "sort", "created_at", "i18n"],
      DEFAULT_BANNERS.map((b, i) => [...b, i + 1, now, json.str(BANNER_I18N[b[1]] ?? {})]),
    );
    created.push("banners");
  }
  if (await empty("promotions")) {
    await insertMany(
      "promotions",
      ["title", "summary", "details", "bonus_percent", "max_bonus", "min_deposit", "turnover_x", "once_per_user", "active", "sort", "created_at", "i18n"],
      DEFAULT_PROMOTIONS.map(([title, summary, details, pct, max, min, x, once], i) => [title, summary, details, pct, max, min, x, once, mode === "production" ? 0 : 1, i, now, json.str(PROMO_I18N[title] ?? {})]),
    );
    created.push("promotions");
  }
  if (await empty("games")) {
    await insertMany(
      "games",
      ["category", "provider", "name", "tag", "hue", "sort"],
      DEFAULT_GAMES.map(([category, provider, name, tag, hue], i) => [category, provider, name, tag, hue, i]),
    );
    created.push("game lobby");
  }
  const settings = await getSettings();
  if (!settings.install.mode) await setSetting("install", { mode, at: now }, now);

  await ensureRounds(now, { daysBack: 0, daysAhead: 1 });
  return { created };
}

/* ---------------------------------------------------------------------------------------------
 * Demo data for a staging install: members, a few days of settled history, and open rounds with
 * enough stake on some numbers that automatic rate cuts are visible. Never run on production.
 * ------------------------------------------------------------------------------------------- */

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["อนุชา", "สุภาพร", "ณัฐพล", "ชไมพร", "ปิยะ", "เกศินี", "วรวุฒิ", "จันทร์เพ็ญ", "ศักดิ์ชัย", "อรอุมา", "กิตติพงษ์", "นภัสสร", "ธีรวัฒน์", "พิมพ์ชนก", "สุรเชษฐ์", "มาลัย", "ประเสริฐ", "รัตนา", "ชัยวัฒน์", "ปวีณา"];
const LAST = ["บุญมา", "รุ่งเรือง", "วงศ์ใหญ่", "ทองคำ", "สุขสวัสดิ์", "เพชรงาม", "ศรีวงศ์", "แก้วมณี", "พรหมมา", "จันทร์หอม"];
const POPULAR = new Set(["thai-gov", "hanoi", "hanoi-vip", "hanoi-special", "laos-vip", "laos-star", "nikkei-pm", "china-pm", "hangseng-pm", "thai-stock"]);
const EXPOSURE_TARGETS = ["thai-gov", "hanoi", "hanoi-vip", "laos-vip", "laos-star", "hanoi-special", "nikkei-pm", "dowjones"];

/** Three "hot" numbers per round and bet type, stable for the round so they build up exposure. */
function hotNumbers(roundId: number, betType: BetTypeCode, digits: number): string[] {
  const h = createHash("sha1").update(`${roundId}:${betType}`).digest();
  return [0, 1, 2].map((i) => String(h.readUInt32BE(i * 4) % 10 ** digits).padStart(digits, "0"));
}

type SeedEvent = { at: number; order: number; run: () => Promise<unknown> };

export async function seedDemo({ now = Date.now(), days = 4, log = (line: string) => void line }: { now?: number; days?: number; log?: (line: string) => void } = {}) {
  if ((await getSettings()).install.mode === "production") throw new Error("Refusing to add demo data to a production install");
  if (await q1("SELECT 1 FROM users WHERE role = 'member' LIMIT 1")) throw new Error("Members already exist; demo data goes on an empty install");
  const started = Date.now();
  const rng = mulberry32(20261104);
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");
  const t0 = now - days * DAY;

  await setSetting("site", { ...DEFAULT_SITE, demoMode: true, simulateCrowd: true });
  await setSetting("wallet", { ...DEFAULT_WALLET, depositAutoApprove: true, slipRequired: false });
  // Demo website accounts: deposits are credited to the first, payouts leave the second.
  if (!(await q1("SELECT 1 FROM bank_accounts LIMIT 1"))) {
    await run(
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, sort, created_at, updated_at)
       VALUES ('deposit', 'kbank', '1238456789', ?, 0, ?, ?), ('withdraw', 'scb', '4058123456', ?, 0, ?, ?)`,
      "บจก. โชคประทาน เอ็นเตอร์เทนเมนต์ (ทดลอง)",
      t0,
      t0,
      "บจก. โชคประทาน เอ็นเตอร์เทนเมนต์ (ทดลอง)",
      t0,
      t0,
    );
  }
  const payoutAccount = (await q1<{ id: number }>("SELECT id FROM bank_accounts WHERE kind = 'withdraw' AND archived_at IS NULL ORDER BY sort, id LIMIT 1"))?.id ?? null;

  // The actor for demo approvals: staff accounts live in the back-office app now, so this is
  // usually null (deposits are then approved by "the system" and the demo withdrawal is skipped).
  const admin = (await q1<{ id: number }>("SELECT id FROM users WHERE role = 'staff' ORDER BY id LIMIT 1"))?.id ?? null;
  const memberHash = hashPasswordSync("demo1234");
  const insertUser = async (u: { phone: string; name: string; bank: [string, string, string]; ref: string; upline1?: number; upline2?: number; balance?: number; simulated?: boolean; created: number; hash?: string }) =>
    (
      await run(
        `INSERT INTO users (phone, password_hash, name, bank_code, bank_account, bank_name, ref_code, upline1_id, upline2_id, balance, is_simulated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u.phone,
        u.hash ?? "disabled",
        u.name,
        ...u.bank,
        u.ref,
        u.upline1 ?? null,
        u.upline2 ?? null,
        u.balance ?? 0,
        u.simulated ? 1 : 0,
        u.created,
      )
    ).lastId;

  const demo = await insertUser({ phone: "0812345678", name: "สมชาย ใจดี", hash: memberHash, bank: ["kbank", "0123456789", "สมชาย ใจดี"], ref: "CHOK88", created: t0 });
  const d1 = await insertUser({ phone: "0891112233", name: "วิภา ศรีสุข", hash: memberHash, bank: ["scb", "4021117788", "วิภา ศรีสุข"], ref: "WIPA21", upline1: demo, created: t0 + HOUR });
  const d2 = await insertUser({ phone: "0823334455", name: "กมลวรรณ แสงทอง", hash: memberHash, bank: ["ktb", "9810023344", "กมลวรรณ แสงทอง"], ref: "KAMOL5", upline1: demo, created: t0 + DAY });
  const d3 = await insertUser({ phone: "0865554433", name: "ธนพล มีโชค", hash: memberHash, bank: ["bbl", "1110567890", "ธนพล มีโชค"], ref: "TANA77", upline1: d1, upline2: demo, created: t0 + 2 * DAY });
  const crowdRows: SqlValue[][] = Array.from({ length: 40 }, (_, i) => [
    `09${digits(8)}`,
    "disabled",
    `${pick(FIRST)} ${pick(LAST)}`,
    pick(["kbank", "scb", "ktb", "bbl", "bay"]),
    digits(10),
    "สมาชิก",
    `SIM${String(i).padStart(3, "0")}`,
    1_000_000_000,
    1,
    t0 + int(0, days - 1) * DAY,
  ]);
  await insertMany("users", ["phone", "password_hash", "name", "bank_code", "bank_account", "bank_name", "ref_code", "balance", "is_simulated", "created_at"], crowdRows);
  const crowd = (await q<{ id: number }>("SELECT id FROM users WHERE is_simulated = 1 ORDER BY id")).map((r) => r.id);
  await insertMany(
    "ref_clicks",
    ["user_id", "at"],
    Array.from({ length: 23 }, () => [demo, t0 + int(0, days - 1) * DAY + int(0, 600) * MINUTE]),
  );
  log(`[seed] ${crowd.length + 4} members`);

  await ensureRounds(now, { daysBack: days, daysAhead: 1 });
  const rounds = await q<{ id: number; slug: string; format: ResultFormat; round_no: number | null; opens_at: number; closes_at: number; draw_at: number; auto_result: number }>(
    `SELECT r.id, l.slug, l.format, r.round_no, r.opens_at, r.closes_at, r.draw_at, l.auto_result
     FROM rounds r JOIN lottos l ON l.id = r.lotto_id WHERE r.closes_at >= ? ORDER BY r.closes_at`,
    t0,
  );

  const events: SeedEvent[] = [];
  let order = 0;
  const at = (time: number, fn: () => Promise<unknown>) => events.push({ at: time, order: order++, run: fn });
  const betRounds = new Set<number>();

  const randomLines = (format: ResultFormat, count: number, stakes: number[]): SlipLine[] => {
    const allowed = betTypesFor(format).filter((c) => c !== "front3" && c !== "bottom3");
    return Array.from({ length: count }, () => {
      const betType = pick(allowed.includes("top2") ? (["top2", "top2", "bottom2", "bottom2", "top3", "tod3", "runTop"] as BetTypeCode[]) : allowed);
      return { betType, number: digits(BET_TYPES[betType].digits), stake: pick(stakes) };
    });
  };
  const betTime = (r: (typeof rounds)[number], earliest: number) => {
    const latest = Math.min(r.closes_at - 2 * MINUTE, now - MINUTE);
    const from = Math.max(r.opens_at + MINUTE, earliest, latest - 6 * HOUR);
    return from >= latest ? null : from + Math.floor(rng() * (latest - from));
  };
  const bet = (userId: number, r: (typeof rounds)[number], lines: SlipLine[], time: number, acceptChanges = false) => {
    betRounds.add(r.id);
    at(time, () => placeBill(userId, r.id, lines, { now: time, acceptChanges }));
  };

  const deposit = (userId: number, baht: number, time: number) =>
    at(time, async () => {
      const d = await createDeposit(userId, baht * 100, null, time);
      if (d.ok) await approveDeposit(d.deposit.id, admin, time + 4 * MINUTE);
    });
  deposit(demo, 3000, t0 + 2 * HOUR);
  deposit(demo, 2000, t0 + 2 * DAY + 3 * HOUR);
  deposit(d1, 2000, t0 + HOUR + 10 * MINUTE);
  deposit(d2, 1500, t0 + DAY + 2 * HOUR);
  deposit(d3, 1000, t0 + 2 * DAY + 2 * HOUR);
  if (admin) {
    at(t0 + 3 * DAY + 4 * HOUR, async () => {
      const w = await requestWithdrawal(demo, 1000_00, t0 + 3 * DAY + 4 * HOUR);
      if (w.ok) await approveWithdrawal(w.id, admin, t0 + 3 * DAY + 4 * HOUR + 18 * MINUTE, null, payoutAccount);
    });
  }

  const past = rounds.filter((r) => r.closes_at < now - 10 * MINUTE);
  const popularPast = past.filter((r) => POPULAR.has(r.slug));
  const demoRounds = new Set<number>();
  for (let i = 0; i < 12 && popularPast.length; i++) demoRounds.add(pick(popularPast).id);
  const designedWin = popularPast.filter((r) => r.slug === "hanoi" && r.closes_at < now - DAY).at(-1);
  if (designedWin) demoRounds.add(designedWin.id);

  for (const r of past) {
    if (POPULAR.has(r.slug) || (r.slug === "yiki" && (r.round_no ?? 0) % 8 === 0)) {
      for (let i = 0; i < (r.slug === "yiki" ? 1 : int(1, 3)); i++) {
        const t = betTime(r, t0);
        if (t) bet(pick(crowd), r, randomLines(r.format, int(1, 4), [20, 50, 100, 200]), t);
      }
    }
    if (demoRounds.has(r.id)) {
      const t = betTime(r, t0 + 3 * HOUR);
      const lines =
        r.id === designedWin?.id
          ? [
              { betType: "top2" as const, number: "68", stake: 50 },
              { betType: "bottom2" as const, number: "21", stake: 50 },
            ]
          : randomLines(r.format, int(1, 3), [10, 20, 50, 100]);
      if (t) bet(demo, r, lines, t);
    }
    for (const member of [d1, d2, d3]) {
      if (POPULAR.has(r.slug) && rng() < 0.1) {
        const t = betTime(r, t0 + DAY);
        if (t) bet(member, r, randomLines(r.format, int(1, 3), [20, 50, 100]), t);
      }
    }
  }
  // Referred members always have some settled play, so the referral pages show real income.
  const funded = t0 + 2 * DAY + 3 * HOUR; // after every downline's first deposit
  const settledPopular = popularPast.filter((r) => r.draw_at < now - HOUR && r.closes_at > funded + 30 * MINUTE);
  for (const member of [d1, d2, d3]) {
    for (let i = 0; i < 2 && settledPopular.length; i++) {
      const r = pick(settledPopular);
      const t = betTime(r, funded);
      if (t) bet(member, r, randomLines(r.format, 2, [50, 100, 200]), t);
    }
  }

  const resultFor = (r: (typeof rounds)[number]) =>
    r.id === designedWin?.id ? { top3: `${digits(1)}68`, bottom2: digits(2) } : randomResult(r.format, rng);

  /* today: open rounds with real exposure, so automatic rate cuts show right away */
  const open = rounds.filter((r) => r.opens_at <= now && r.closes_at > now + 30 * MINUTE);
  const targets = [
    ...EXPOSURE_TARGETS.map((slug) => open.find((r) => r.slug === slug)).filter((r) => r !== undefined),
    ...open.filter((r) => r.slug === "yiki").slice(0, 2),
  ];
  for (const r of targets) {
    const heavy = r.slug === "thai-gov" ? 1.6 : 1;
    const plan: [BetTypeCode, number[]][] = [
      ["top2", [9, 3, 1]],
      ["bottom2", [8, 3, 1]],
      ["top3", [5, 2, 1]],
      ["tod3", [2, 1, 0]],
    ].filter(([code]) => betTypesFor(r.format).includes(code as BetTypeCode)) as [BetTypeCode, number[]][];
    const hot = new Map(plan.map(([code]) => [code, hotNumbers(r.id, code, BET_TYPES[code].digits)]));
    const billCount = Math.max(...plan.flatMap(([, c]) => c.map((n) => Math.round(n * heavy))));
    // Bill k carries every hot number that still needs a k-th stake: few bills, same totals.
    for (let k = 0; k < billCount; k++) {
      const lines: SlipLine[] = [];
      for (const [code, counts] of plan) {
        counts.forEach((n, i) => {
          if (k < Math.round(n * heavy)) lines.push({ betType: code, number: hot.get(code)![i], stake: 2000 });
        });
      }
      const t = Math.max(r.opens_at + MINUTE, now - int(15, 240) * MINUTE);
      if (lines.length) bet(pick(crowd), r, lines, t, true);
    }
    for (let k = 0; k < (r.slug === "yiki" ? 3 : 8); k++) {
      const t = Math.max(r.opens_at + MINUTE, now - int(15, 240) * MINUTE);
      bet(pick(crowd), r, randomLines(r.format, int(1, 4), [20, 50, 100, 200, 500]), t);
    }
  }
  const demoOpen = targets.find((r) => r.slug === "hanoi") ?? targets[0];
  const govOpen = targets.find((r) => r.slug === "thai-gov");
  if (demoOpen) {
    const [hot] = hotNumbers(demoOpen.id, "top2", 2);
    bet(
      demo,
      demoOpen,
      [
        { betType: "top2", number: hot, stake: 100 },
        { betType: "top2", number: hot.split("").reverse().join(""), stake: 100 },
        { betType: "bottom2", number: "38", stake: 50 },
      ],
      now - 6 * MINUTE,
      true,
    );
  }
  if (govOpen) {
    bet(
      demo,
      govOpen,
      [
        { betType: "top3", number: "589", stake: 20 },
        { betType: "tod3", number: "589", stake: 20 },
        { betType: "top2", number: "89", stake: 50 },
        { betType: "bottom2", number: "17", stake: 50 },
      ],
      now - 3 * HOUR,
    );
  }

  /* results: rounds with bills settle through the real path, the rest are recorded directly */
  for (const r of past) {
    if (r.draw_at > now) continue;
    if (betRounds.has(r.id)) {
      at(r.draw_at, () => setResult(r.id, resultFor(r), r.auto_result ? null : admin, r.draw_at));
    } else {
      at(r.draw_at, async () => {
        const derived = deriveResult(r.format, resultFor(r));
        if (!derived.ok) return;
        await run(
          "UPDATE rounds SET status = 'resulted', result = ?, resulted_at = ?, settled_at = ? WHERE id = ? AND status = 'scheduled'",
          json.str(derived.result as RoundResult),
          r.draw_at,
          r.draw_at,
          r.id,
        );
      });
    }
  }

  /* pending items for the back-office queues */
  for (let i = 0; i < 3; i++) {
    const time = now - int(3, 40) * MINUTE;
    at(time, async () => {
      const d = await createDeposit(pick(crowd), pick([300, 500, 1000, 2000]) * 100, null, time);
      if (d.ok) await run("UPDATE deposits SET status = 'pending', confirmed_at = ?, expires_at = ? WHERE id = ?", time + MINUTE, now + DAY, d.deposit.id);
    });
  }
  for (let i = 0; i < 2; i++) {
    const time = now - int(5, 50) * MINUTE;
    at(time, () => requestWithdrawal(pick(crowd), pick([500, 1500, 3000]) * 100, time));
  }

  events.sort((a, b) => a.at - b.at || a.order - b.order);
  let done = 0;
  for (const e of events) {
    await e.run();
    if (++done % 100 === 0) log(`[seed] ${done}/${events.length} events`);
  }

  await run("INSERT INTO vouchers (code, value, max_uses, expires_at, note, created_at) VALUES ('WELCOME100', 10000, 1000, ?, 'สมาชิกใหม่', ?)", now + 30 * DAY, t0);
  await run("INSERT INTO vouchers (code, value, max_uses, expires_at, note, created_at) VALUES ('LUCKY50', 5000, 500, ?, 'แจกในไลน์', ?)", now + 14 * DAY, t0);
  await insertMany(
    "news",
    ["title", "body", "pinned", "created_at"],
    [
      ["หวยรัฐบาลงวดถัดไปเปิดรับแล้ว", "ปิดรับเวลา 15:10 น. ของวันออกรางวัล ผลประกาศประมาณ 16:00 น. ระบบจ่ายเงินเข้ากระเป๋าทันทีที่ออกผล", 1, now - 2 * DAY],
      ["อัตราจ่ายปรับอัตโนมัติเมื่อเลขมียอดแทงสูง", "เลขที่มียอดแทงรวมสูงจะได้อัตราจ่ายลดลงเป็นขั้น เฉพาะส่วนที่แทงหลังถึงขั้นนั้น ก่อนกดยืนยันคุณจะเห็นอัตราที่ได้จริงของทุกเลข และในแผงเลขจะมีป้าย \"อั้น\" กำกับไว้", 0, now - 3 * DAY],
    ],
  );
  await run(
    "INSERT INTO number_sets (user_id, name, items, created_at) VALUES (?, 'เลขประจำตัว', ?, ?)",
    demo,
    json.str([
      { betType: "top2", number: "25", stake: 50 },
      { betType: "top2", number: "52", stake: 50 },
      { betType: "top3", number: "925", stake: 20 },
      { betType: "bottom2", number: "49", stake: 50 },
    ]),
    t0 + DAY,
  );
  log(`[seed] demo data ready in ${Math.round((Date.now() - started) / 1000)}s (${events.length} events)`);
  return { demo };
}
