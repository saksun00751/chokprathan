import Link from "next/link";
import { ChevronLeft, Dices, Gamepad2, Trophy, Volleyball } from "lucide-react";
import { Suspense } from "react";
import { PageHeader, Skeleton, TabLinks } from "@/components/ui/primitives";
import { GAME_GROUPS, type GameGroup } from "@/domain/game-products";
import { fmt } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getGameLobby } from "@/server/data/games";
import { getGames, type GameCategory } from "@/server/data/member";
import { GameGrid } from "./game-grid";
import { PlayGrid } from "./play-grid";

export const generateMetadata = () => pageMeta("games");

const ICON: Record<GameGroup, typeof Gamepad2> = { slot: Gamepad2, casino: Dices, sport: Volleyball, other: Trophy };
const HUE: Record<GameGroup, number> = { slot: 282, casino: 22, sport: 150, other: 250 };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function GamesPage({ searchParams }: PageProps<"/[lang]/games">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.games.title} description={t.site.games.description} />
      <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
        <GamesBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function GamesBody({ searchParams }: Pick<PageProps<"/[lang]/games">, "searchParams">) {
  const sp = await searchParams;
  const [lobby, { t }] = await Promise.all([getGameLobby({ group: one(sp.group), product: one(sp.product) }), getI18n()]);
  const g = t.site.games;
  if (!lobby.ready) return <Placeholder category={one(sp.category)} />;

  const tabs = [
    { href: "/games", label: t.common.all, active: lobby.group === null && !lobby.selected },
    ...GAME_GROUPS.filter((k) => lobby.counts[k] > 0).map((k) => ({
      href: `/games?group=${k}`,
      label: g.categories[k],
      active: lobby.group === k || lobby.selected?.group === k,
    })),
  ];

  if (lobby.selected) {
    const p = lobby.selected;
    return (
      <>
        <TabLinks label={g.tabsLabel} className="mb-5" items={tabs} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href={`/games?group=${p.group}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            <ChevronLeft className="size-4" aria-hidden="true" />
            {g.allProviders}
          </Link>
          <h2 className="text-lg font-semibold">{p.name}</h2>
          <span className="text-sm text-ink-3">{fmt(g.gamesCount, { n: lobby.games.length })}</span>
        </div>
        <PlayGrid productId={p.id} games={lobby.games} signedIn={lobby.signedIn} />
      </>
    );
  }

  return (
    <>
      <TabLinks label={g.tabsLabel} className="mb-5" items={tabs} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {lobby.products.map((p) => {
          const Icon = ICON[p.group];
          return (
            <li key={p.id}>
              <Link
                href={`/games?group=${p.group}&product=${encodeURIComponent(p.id)}`}
                className="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-card p-3 text-white shadow-card"
                style={{ background: `linear-gradient(140deg, oklch(0.38 0.13 ${HUE[p.group]}), oklch(0.26 0.1 ${HUE[p.group] + 20}))` }}
              >
                <Icon className="absolute top-3 right-3 size-6 text-white/70 transition-transform group-hover:scale-110" aria-hidden="true" />
                <span className="text-base leading-tight font-semibold">{p.name}</span>
                <span className="text-xs text-white/80">
                  {g.categories[p.group]} · {fmt(g.gamesCount, { n: p.games })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Until the game catalog has been synced from the aggregator, the page keeps its preview. */
async function Placeholder({ category }: { category?: string }) {
  const { t } = await getI18n();
  const TABS: (GameCategory | "all")[] = ["all", "casino", "slot", "sport"];
  const active = TABS.find((k) => k === category) ?? "all";
  const games = await getGames(active === "all" ? undefined : active);
  return (
    <>
      <TabLinks
        label={t.site.games.tabsLabel}
        className="mb-5"
        items={TABS.map((k) => ({
          href: k === "all" ? "/games" : `/games?category=${k}`,
          label: k === "all" ? t.common.all : t.site.games.categories[k],
          active: k === active,
        }))}
      />
      <GameGrid games={games} />
    </>
  );
}
