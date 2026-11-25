"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { MenuArt } from "@/components/art/scenes";
import { RoundCard } from "@/components/lotto/round-card";
import { Countdown, LiveClock, ServerTimeSync, useNow } from "@/components/ui/clock";
import { Flag } from "@/components/ui/flag";
import { EmptyState } from "@/components/ui/primitives";
import { isBuiltinGroup, isGroupArt } from "@/domain/lotto-groups";
import { useI18n } from "@/i18n/client";
import { fmt, formatClock } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { GroupView } from "@/server/data/groups";
import type { LobbyData, LobbyRound } from "@/server/data/lobby";

/** A group code, or "all". */
type Filter = string;

export function LobbyView({ data, groups: allGroups, initialGroup }: { data: LobbyData; groups: GroupView[]; initialGroup: Filter }) {
  const { t } = useI18n();
  const lb = t.site.lobby;
  const [filter, setFilter] = useState<Filter>(initialGroup);
  const [query, setQuery] = useState("");
  const now = useNow(data.serverNow);

  const needle = query.trim().toLocaleLowerCase();
  const has = (text: string) => text.toLocaleLowerCase().includes(needle);
  const match = (r: LobbyRound) => !needle || has(r.name) || has(r.shortName);
  const visible = data.rounds.filter((r) => r.closesAt > now && match(r));
  const yiki = data.yiki.filter((r) => r.closesAt > now);
  const closingSoon = visible.filter((r) => r.phase !== "upcoming" && r.closesAt - now <= 60 * 60_000).slice(0, 4);

  // Built-ins always have a tab; a staff-made group gets one once it has a lottery taking bets.
  const tabs = allGroups.filter((g) => isBuiltinGroup(g.code) || data.rounds.some((r) => r.group === g.code));
  const counts: Record<Filter, number> = {
    ...Object.fromEntries(tabs.map((g) => [g.code, visible.filter((r) => r.group === g.code).length])),
    all: visible.length + (yiki.length ? 1 : 0),
    yiki: yiki.length,
  };
  const yikiLabel = allGroups.find((g) => g.code === "yiki")?.label ?? t.lotto.groups.yiki;
  const notes: Readonly<Record<string, string>> = lb.notes;

  const groups = tabs.filter((g) => g.code !== "yiki" && (filter === "all" || filter === g.code));
  const showYiki = (filter === "all" || filter === "yiki") && (!needle || has(yikiLabel));

  return (
    <div>
      <ServerTimeSync serverNow={data.serverNow} />
      <div className="sticky top-[60px] z-20 -mx-4 mb-5 border-b border-line bg-canvas/95 px-4 pt-1 pb-3 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-4 min-w-0 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label={lb.tabsLabel}>
            <div className="flex w-max gap-1 rounded-control bg-panel p-1">
              {["all", ...tabs.map((x) => x.code)].map((g) => (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={filter === g}
                  onClick={() => setFilter(g)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium whitespace-nowrap transition-colors",
                    filter === g ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {g === "all" ? t.common.all : tabs.find((x) => x.code === g)?.label}
                  <span className="tnum text-xs text-ink-3">{counts[g]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="relative flex-1 md:w-64 md:flex-none">
              <span className="sr-only">{lb.searchLabel}</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={lb.searchPlaceholder}
                className="h-10 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-ink-3 focus-visible:border-brand"
              />
            </label>
            <p className="hidden shrink-0 text-sm text-ink-2 sm:block">
              {t.common.thaiTime} <LiveClock serverNow={data.serverNow} className="font-semibold text-ink" />
            </p>
          </div>
        </div>
      </div>

      {filter === "all" && !query && closingSoon.length > 0 && (
        <section aria-labelledby="soon" className="mb-8">
          <h2 id="soon" className="mb-3 text-lg font-semibold">
            {lb.closingSoon}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {closingSoon.map((r) => (
              <RoundCard key={r.id} round={r} serverNow={data.serverNow} />
            ))}
          </div>
        </section>
      )}

      {groups.map(({ code: g, label, art }) => {
        const list = visible.filter((r) => r.group === g);
        if (list.length === 0) return null;
        return (
          <section key={g} aria-labelledby={`g-${g}`} className="mb-8">
            <div className="mb-3 flex items-center gap-3">
              <MenuArt art={isGroupArt(art) ? art : "ticket"} className="size-11 shrink-0" />
              <div>
                <h2 id={`g-${g}`} className="text-lg leading-tight font-semibold">
                  {label}
                </h2>
                {notes[g] && <p className="text-sm text-ink-3">{notes[g]}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {list.map((r) => (
                <RoundCard key={r.id} round={r} serverNow={data.serverNow} />
              ))}
            </div>
          </section>
        );
      })}

      {showYiki && yiki.length > 0 && (
        <section aria-labelledby="g-yiki" className="mb-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <MenuArt art="balls" className="size-11 shrink-0" />
              <div>
                <h2 id="g-yiki" className="text-lg leading-tight font-semibold">
                  {yikiLabel}
                </h2>
                <p className="text-sm text-ink-3">{lb.notes.yiki}</p>
              </div>
            </div>
          </div>
          <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {yiki.slice(0, filter === "yiki" ? 12 : 6).map((r, i) => (
              <li key={r.id} className={cn(i > 0 && "border-t border-line")}>
                <Link href={`/lotto/${r.id}`} prefetch={false} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
                  <Flag code="YK" className="size-6" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span className="block text-xs text-ink-3">
                      {lb.card.closes} <span className="tnum">{formatClock(r.closesAt)}</span>
                      {r.cutCount > 0 && <span className="ml-2 font-semibold text-warning">{fmt(lb.card.cuts, { n: r.cutCount })}</span>}
                    </span>
                  </span>
                  <Countdown closesAt={r.closesAt} serverNow={data.serverNow} className="text-base" />
                  <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visible.length === 0 && !(showYiki && yiki.length) && (
        <EmptyState
          icon={<Search className="size-5" />}
          title={needle ? fmt(lb.noMatch.title, { query: query.trim() }) : lb.empty.title}
          description={needle ? lb.noMatch.body : lb.empty.body}
        />
      )}
    </div>
  );
}
