import "server-only";
import { io } from "next/cache";
import { isGameGroup, productName, type GameGroup } from "@/domain/game-products";
import type { Locale } from "@/i18n/config";
import { getI18n } from "@/i18n/rsc";
import { memo } from "@/server/cache";
import { GAME_CATALOG_TTL_MS, GAME_PRODUCTS_TTL_MS } from "@/server/cache-ttl";
import { json, q, tolerateMissingTable } from "@/server/db";
import { getViewer } from "@/server/session";

export interface LobbyProduct {
  id: string;
  name: string;
  group: GameGroup;
  games: number;
}

export interface LobbyGame {
  code: string;
  name: string;
  img: string | null;
}

const localName = (names: string | null, fallback: string, lang: Locale) => {
  const n = json.parse<{ th?: string; en?: string; cn?: string }>(names, {});
  return (lang === "th" ? n.th || n.en : n.en || n.th) || fallback;
};

/** Products members can play: switched on, offered by the aggregator, and with games. Cached briefly. */
const playable = () =>
  memo("games:products", GAME_PRODUCTS_TTL_MS, () =>
    tolerateMissingTable(
      () =>
        q<{ product_id: string; name: string; grp: string; games: number }>(
          "SELECT product_id, name, grp, games FROM game_products WHERE enabled = 1 AND available = 1 AND games > 0 ORDER BY sort, name",
        ),
      [],
    ),
  );

/**
 * The games lobby: products by group (slots, live casino, sports, other) and, for a chosen
 * product, its games. `ready` is false until the catalog has been synced: the page then keeps its
 * placeholder.
 */
export async function getGameLobby({ group, product }: { group?: string; product?: string }) {
  const { lang } = await getI18n();
  await io();
  const [rows, viewer] = await Promise.all([playable(), getViewer()]);
  const all: LobbyProduct[] = rows.map((p) => ({ id: p.product_id, name: p.name, group: isGameGroup(p.grp) ? p.grp : "other", games: Number(p.games) }));
  if (all.length === 0) return { ready: false as const };
  const g = isGameGroup(group) ? group : null;
  const selected = product ? (all.find((p) => p.id === product) ?? null) : null;
  const games: LobbyGame[] = selected
    ? (
        await memo(`games:catalog:${selected.id}`, GAME_CATALOG_TTL_MS, () =>
          q<{ code: string; name: string; names: string | null; img: string | null }>(
            "SELECT code, name, names, img FROM game_catalog WHERE product_id = ? ORDER BY rank_no, id LIMIT 1000",
            selected.id,
          ),
        )
      ).map((r) => ({ code: r.code, name: localName(r.names, r.name, lang), img: r.img }))
    : [];
  const counts = Object.fromEntries((["slot", "casino", "sport", "other"] as const).map((k) => [k, all.filter((p) => p.group === k).length])) as Record<
    GameGroup,
    number
  >;
  return {
    ready: true as const,
    signedIn: !!viewer && viewer.role === "member",
    group: g,
    counts,
    products: g ? all.filter((p) => p.group === g) : all,
    selected,
    games,
  };
}

export interface GameHistoryRow {
  id: number;
  product: string;
  game: string;
  kind: string;
  status: string;
  bet: number;
  payout: number;
  net: number;
  at: number;
}

/** A member's latest game transactions with what each did to their balance. */
export async function gameHistory(userId: number, lang: Locale, limit = 100): Promise<GameHistoryRow[]> {
  const rows = await tolerateMissingTable(
    () =>
      q<{
        id: number;
        product_id: string;
        game_code: string | null;
        kind: string;
        status: string;
        debited: number;
        credited: number;
        created_at: number;
        game_name: string | null;
        names: string | null;
        product: string | null;
      }>(
        `SELECT t.id, t.product_id, t.game_code, t.kind, t.status, t.debited, t.credited, t.created_at, c.name AS game_name, c.names, p.name AS product
         FROM game_txns t
         LEFT JOIN game_catalog c ON c.product_id = t.product_id AND c.code = t.game_code
         LEFT JOIN game_products p ON p.product_id = t.product_id
         WHERE t.user_id = ? ORDER BY t.id DESC LIMIT ?`,
        userId,
        limit,
      ),
    [],
  );
  return rows.map((r) => {
    // Refunded and voided stakes went back: they cost nothing.
    const back = r.status === "REFUND" || r.status === "REJECT" || r.status === "VOID";
    const bet = back ? 0 : Number(r.debited);
    const payout = back ? 0 : Number(r.credited);
    return {
      id: r.id,
      product: r.product ?? productName(r.product_id),
      game: r.game_name ? localName(r.names, r.game_name, lang) : (r.game_code ?? "-"),
      kind: r.kind,
      status: r.status,
      bet,
      payout,
      net: payout - bet,
      at: r.created_at,
    };
  });
}
