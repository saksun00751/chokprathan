"use client";

import { LoaderCircle, Play, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { launchGameAction } from "@/server/actions/games";
import type { LobbyGame } from "@/server/data/games";

/**
 * One provider's games. Tapping a game asks the server for a game URL (the aggregator signs the
 * member in) and goes there; the game comes back to /games when the member leaves it.
 */
export function PlayGrid({ productId, games, signedIn }: { productId: string; games: LobbyGame[]; signedIn: boolean }) {
  const { t } = useI18n();
  const g = t.site.games;
  const toast = useToast();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const list = query.trim() ? games.filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase())) : games;

  const play = async (code: string) => {
    if (opening) return;
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/games?product=${productId}`)}`);
      return;
    }
    setOpening(code);
    const mobile = window.matchMedia("(max-width: 768px)").matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const r = await launchGameAction(productId, code, mobile);
    if (r.ok) {
      // The game lives on the aggregator's domain: a full page load, not a client-side route.
      window.location.assign(r.data.url);
      return;
    }
    setOpening(null);
    toast.error(r.error);
  };

  return (
    <div className="flex flex-col gap-4">
      {games.length > 12 && (
        <label className="relative block max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <span className="sr-only">{g.search}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={g.search}
            className="h-11 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9"
          />
        </label>
      )}
      {list.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-ink-3">{g.noGames}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {list.map((x) => (
            <li key={x.code}>
              <button
                type="button"
                onClick={() => play(x.code)}
                disabled={opening !== null}
                aria-label={`${g.play} ${x.name}`}
                className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-wait"
              >
                <span className="relative block aspect-square w-full overflow-hidden rounded-card bg-brand-deep shadow-card">
                  {x.img ? (
                    // Game art comes from the aggregator's CDN, whose hosts vary by provider.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={x.img}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <span className="grid size-full place-items-center p-2 text-center text-sm font-semibold text-white">{x.name}</span>
                  )}
                  <span
                    className={cn(
                      "absolute inset-0 grid place-items-center bg-ink/45 text-white transition-opacity",
                      opening === x.code ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                    aria-hidden="true"
                  >
                    {opening === x.code ? <LoaderCircle className="size-7 animate-spin" /> : <Play className="size-7" />}
                  </span>
                </span>
                <span className="line-clamp-2 text-sm leading-snug font-medium text-ink">{x.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!signedIn && (
        <p className="text-sm text-ink-3">
          <Link href={`/login?next=${encodeURIComponent(`/games?product=${productId}`)}`} className="font-semibold text-brand hover:underline">
            {g.signInToPlay}
          </Link>
        </p>
      )}
    </div>
  );
}
