import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BetComposer } from "@/components/bet/composer";
import { Skeleton } from "@/components/ui/primitives";
import { Provide } from "@/i18n/provide";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getBetPage, getUnpricedBetRound } from "@/server/data/bet";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("bet");

export default function BetPage({ params, searchParams }: PageProps<"/[lang]/lotto/[roundId]">) {
  return (
    <Suspense fallback={<BetSkeleton />}>
      <BetBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BetBody({ params, searchParams }: Pick<PageProps<"/[lang]/lotto/[roundId]">, "params" | "searchParams">) {
  const [{ roundId }, { rebet }] = await Promise.all([params, searchParams]);
  const id = Number(roundId);
  if (!Number.isInteger(id)) notFound();
  const viewer = await requireViewer(`/lotto/${roundId}`);
  const data = await getBetPage(id, viewer, typeof rebet === "string" ? Number(rebet) : undefined);
  if (!data) {
    const waiting = await getUnpricedBetRound(id);
    if (!waiting) notFound();
    return <NotPriced {...waiting} />;
  }
  return (
    <Provide ns={["play"]}>
      <BetComposer data={data} />
    </Provide>
  );
}

async function NotPriced({ lottoName, roundLabel }: { lottoName: string; roundLabel: string }) {
  const { t } = await getI18n();
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-8 text-center shadow-card">
      <h1 className="text-lg font-semibold">
        {lottoName} · {roundLabel}
      </h1>
      <p className="text-ink-2">{t.play.composer.notPriced}</p>
      <Link href="/lotto" className="text-sm font-semibold text-brand hover:underline">
        {t.play.composer.pickAnother}
      </Link>
    </div>
  );
}

function BetSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <Skeleton className="h-24 rounded-card" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-10" />
          <Skeleton className="h-16 rounded-card" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </div>
        <Skeleton className="hidden h-96 rounded-card lg:block" />
      </div>
    </div>
  );
}
