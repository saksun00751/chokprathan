import "server-only";
import { io } from "next/cache";
import { getI18n } from "@/i18n/rsc";
import { memo } from "@/server/cache";
import { CONTENT_TTL_MS } from "@/server/cache-ttl";
import { json, q } from "@/server/db";
import { affiliateSummary, cashbackSummary, downlines } from "@/server/services/retention";
import { getSettings } from "@/server/services/settings";
import type { SavedSet } from "./bet";

export async function getCashbackPage(userId: number) {
  await io();
  const [recent, summary, settings] = await Promise.all([
    q<{ id: number; amount: number; ref: string | null; created_at: number; type: string }>(
      "SELECT id, amount, ref, created_at, type FROM transactions WHERE user_id = ? AND wallet = 'cashback' ORDER BY created_at DESC, id DESC LIMIT 20",
      userId,
    ),
    cashbackSummary(userId),
    getSettings(),
  ]);
  return { summary, recent, cashbackBp: settings.rewards.cashbackBp };
}

export async function getAffiliatePage(userId: number) {
  await io();
  const [summary, list, settings] = await Promise.all([affiliateSummary(userId), downlines(userId), getSettings()]);
  return { summary, downlines: list, aff1Bp: settings.rewards.aff1Bp, aff2Bp: settings.rewards.aff2Bp };
}

export async function getVoucherHistory(userId: number) {
  await io();
  return q<{ code: string; value: number; created_at: number }>(
    `SELECT v.code, v.value, r.created_at FROM voucher_redemptions r JOIN vouchers v ON v.id = r.voucher_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    userId,
  );
}

type Tr<T> = Partial<Record<string, Partial<T>>>;
/** Per-language text with the Thai columns as the fallback for anything left empty. */
function localize<T extends Record<string, unknown>, K extends keyof T & string>(row: T & { i18n: string | null }, lang: string, keys: K[]): T {
  if (lang === "th") return row;
  const tr = (json.parse<Tr<Record<K, string>>>(row.i18n, {})[lang] ?? {}) as Partial<Record<K, string>>;
  const out = { ...row };
  for (const k of keys) if (tr[k]) (out as Record<string, unknown>)[k] = tr[k];
  return out;
}

export async function getPromotions() {
  const { lang } = await getI18n();
  await io();
  const rows = await memo("content:promotions", CONTENT_TTL_MS, () =>
    q<{ id: number; title: string; summary: string; details: string; bonus_percent: number; max_bonus: number; min_deposit: number; turnover_x: number; i18n: string | null }>(
      "SELECT id, title, summary, details, bonus_percent, max_bonus, min_deposit, turnover_x, i18n FROM promotions WHERE active = 1 ORDER BY sort, id",
    ),
  );
  // The kind comes from the Thai title, before it is swapped for the visitor's language.
  return rows.map((r) => ({
    ...localize(r, lang, ["title", "summary", "details"]),
    kind: r.bonus_percent > 0 ? ("bonus" as const) : r.title.includes("คืน") ? ("cashback" as const) : ("affiliate" as const),
  }));
}

export async function getNumberSets(userId: number): Promise<SavedSet[]> {
  await io();
  return (
    await q<{ id: number; name: string; items: string }>(
      "SELECT id, name, items FROM number_sets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      userId,
    )
  ).map((s) => ({ id: s.id, name: s.name, items: json.parse<SavedSet["items"]>(s.items, []) }));
}

export async function getNews(limit = 10) {
  const { lang } = await getI18n();
  await io();
  const rows = await memo("content:news", CONTENT_TTL_MS, () =>
    q<{ id: number; title: string; body: string; pinned: number; created_at: number; i18n: string | null }>(
      "SELECT id, title, body, pinned, created_at, i18n FROM news WHERE published = 1 ORDER BY pinned DESC, created_at DESC LIMIT 50",
    ),
  );
  return rows.slice(0, limit).map((r) => localize(r, lang, ["title", "body"]));
}

export type GameCategory = "casino" | "slot" | "sport";

export async function getGames(category?: GameCategory) {
  const { t } = await getI18n();
  await io();
  const all = await memo("content:games", 60_000, () =>
    q<{ id: number; category: GameCategory; provider: string; name: string; tag: string | null; hue: number }>(
      "SELECT id, category, provider, name, tag, hue FROM games WHERE enabled = 1 ORDER BY sort",
    ),
  );
  // Seeded game names and providers have translations keyed by their Thai name.
  const named = all.map((g) => ({ ...g, name: t.info.games.names[g.name] ?? g.name, provider: t.info.games.providers[g.provider] ?? g.provider, tag: g.tag ? (t.info.games.tags[g.tag] ?? g.tag) : null }));
  return category ? named.filter((g) => g.category === category) : named;
}
