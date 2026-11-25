import Link from "next/link";
import { Sparkles, Target } from "lucide-react";
import { Suspense } from "react";
import { GuessGame } from "@/components/activities/guess-game";
import { LuckyWheel } from "@/components/activities/lucky-wheel";
import { Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatBaht } from "chokprathan-core/rules/money";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/rsc";
import { getActivitiesPage } from "@/server/data/activities";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.site.activities.title, description: t.site.activities.description };
}

export default async function ActivitiesPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.site.activities.title} description={t.site.activities.description} />
      <Suspense fallback={<Skeleton className="h-[560px] rounded-card" />}>
        <ActivitiesBody />
      </Suspense>
    </>
  );
}

async function ActivitiesBody() {
  const [data, { t }] = await Promise.all([getActivitiesPage(), getI18n()]);
  const a = t.site.activities;
  const { me, wheel, guess, pointRule } = data;
  if (!wheel.enabled && !guess.enabled) {
    return <p className="rounded-card border border-line bg-surface px-5 py-10 text-center text-ink-3">{a.closed}</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-brand-deep px-5 py-4 text-white">
        <div>
          <p className="text-sm text-on-deep-2">{a.pointsLabel}</p>
          <p className="text-[1.75rem] leading-tight font-semibold">{me ? me.points.toLocaleString("en-US") : "-"}</p>
        </div>
        <p className="max-w-md text-sm text-on-deep-2">
          {pointRule.enabled ? fmt(a.earnRule, { amount: formatBaht(pointRule.every, { decimals: "auto" }), n: pointRule.points }) : ""}{" "}
          <Link href="/wallet/deposit" className="font-semibold text-white underline-offset-2 hover:underline">
            {a.deposit}
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {wheel.enabled && (
          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="size-5 text-gold-text" aria-hidden="true" />
              {a.wheelTitle}
            </h2>
            <LuckyWheel
              prizes={wheel.prizes}
              cost={wheel.cost}
              turnoverX={wheel.turnoverX}
              points={me?.points ?? 0}
              spinsLeft={wheel.dailyLimit > 0 && me ? Math.max(0, wheel.dailyLimit - me.spinsToday) : null}
              signedIn={!!me}
            />
          </Card>
        )}
        {guess.enabled && (
          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Target className="size-5 text-brand" aria-hidden="true" />
              {a.guessTitle}
            </h2>
            <GuessGame
              rounds={guess.rounds}
              cost={guess.cost}
              prize={guess.prize}
              maxPerRound={guess.maxPerRound}
              turnoverX={guess.turnoverX}
              shared={guess.shared}
              guesses={me?.guesses ?? []}
              points={me?.points ?? 0}
              signedIn={!!me}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
