"use client";

import Link from "next/link";
import { formatRate } from "chokprathan-core/rules/money";
import { useI18n } from "@/i18n/client";
import { fmt, formatClock, formatDate } from "@/i18n/format";
import { Countdown, UrgencyLabel } from "@/components/ui/clock";
import { Flag } from "@/components/ui/flag";
import type { LobbyRound } from "@/server/data/lobby";
import { cn } from "@/lib/cn";

export function RoundCard({ round, serverNow, className }: { round: LobbyRound; serverNow: number; className?: string }) {
  const { t, lang } = useI18n();
  const c = t.site.lobby.card;
  const upcoming = round.phase === "upcoming";
  const sameDay = round.closesAt - serverNow < 20 * 3_600_000;
  return (
    <Link
      href={`/lotto/${round.id}`}
      prefetch={false}
      className={cn(
        "group flex min-w-0 flex-col rounded-card border border-line bg-surface p-3.5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-brand/40 hover:shadow-[0_4px_16px_oklch(0.22_0.03_285/0.08)] sm:p-4",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Flag code={round.flag} className="size-6 sm:size-7" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug font-semibold text-ink sm:text-base">{round.shortName}</p>
          <p className="truncate text-xs text-ink-3">{round.label}</p>
        </div>
      </div>
      <div className="mt-3">
        {upcoming ? (
          <>
            <p className="text-xs text-ink-3">{c.opensIn}</p>
            <Countdown closesAt={round.opensAt} serverNow={serverNow} className="text-lg sm:text-xl" />
          </>
        ) : (
          <Countdown closesAt={round.closesAt} serverNow={serverNow} className="text-lg sm:text-xl" />
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
          <span>
            {c.closes} {sameDay ? "" : `${formatDate(round.closesAt, lang)} `}
            <span className="tnum">{formatClock(round.closesAt)}</span>
          </span>
          <UrgencyLabel closesAt={round.closesAt} serverNow={serverNow} />
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-xs text-ink-2">
        {round.headline.slice(0, 2).map((h) => (
          <span key={h.code} className="whitespace-nowrap">
            {h.short} <b className="tnum font-semibold text-ink">×{formatRate(h.rate100)}</b>
          </span>
        ))}
        {round.cutCount > 0 && (
          <span className="ml-auto rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning">{fmt(c.cuts, { n: round.cutCount })}</span>
        )}
      </div>
    </Link>
  );
}

export function RoundCardSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4" aria-hidden="true">
      <div className="flex gap-2.5">
        <div className="skeleton size-7 rounded-full" />
        <div className="flex-1">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton mt-1.5 h-3 w-16" />
        </div>
      </div>
      <div className="skeleton mt-4 h-6 w-28" />
      <div className="skeleton mt-2 h-3 w-20" />
      <div className="skeleton mt-4 h-3 w-full" />
    </div>
  );
}
