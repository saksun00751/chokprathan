import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Flag } from "@/components/ui/flag";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { fmt, formatDateTime } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getLottoHistory } from "@/server/data/results";

export const generateMetadata = () => pageMeta("history");

export default function LottoHistoryPage({ params }: PageProps<"/[lang]/results/[lottoSlug]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] rounded-card" />}>
      <HistoryBody params={params} />
    </Suspense>
  );
}

async function HistoryBody({ params }: Pick<PageProps<"/[lang]/results/[lottoSlug]">, "params">) {
  const { lottoSlug } = await params;
  const [data, { lang, t }] = await Promise.all([getLottoHistory(lottoSlug, 60), getI18n()]);
  const r_ = t.info.results;
  const res = t.lotto.result;
  if (!data) notFound();
  const { lotto, rounds } = data;
  const gov = lotto.format === "thai_gov";
  const laos = lotto.format === "laos4";

  return (
    <>
      <PageHeader
        back={{ href: "/results", label: t.meta.results.title }}
        title={
          <span className="flex items-center gap-3">
            <Flag code={lotto.flag} className="size-8" />
            {lotto.name}
          </span>
        }
        description={fmt(r_.historyDescription, { n: rounds.length })}
      />
      {rounds.length === 0 ? (
        <Card>
          <EmptyState title={r_.emptyTitle} description={r_.emptyBody} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-panel text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">{r_.draw}</th>
                <th className="px-4 py-2.5 font-medium">{r_.closes}</th>
                {gov && <th className="px-4 py-2.5 text-right font-medium">{res.first6}</th>}
                {gov && <th className="px-4 py-2.5 text-right font-medium">{res.front3}</th>}
                {gov && <th className="px-4 py-2.5 text-right font-medium">{res.back3}</th>}
                {laos && <th className="px-4 py-2.5 text-right font-medium">{res.top4}</th>}
                {!gov && <th className="px-4 py-2.5 text-right font-medium">{res.top3}</th>}
                <th className="px-4 py-2.5 text-right font-medium">{res.bottom2}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.label}</td>
                  <td className="tnum px-4 py-2.5 whitespace-nowrap text-ink-2">{formatDateTime(r.closesAt, lang)}</td>
                  {gov && <td className="tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em] text-brand">{r.result.first6}</td>}
                  {gov && <td className="tnum px-4 py-2.5 text-right tracking-[0.06em]">{r.result.front3?.join(" ")}</td>}
                  {gov && <td className="tnum px-4 py-2.5 text-right tracking-[0.06em]">{r.result.back3?.join(" ")}</td>}
                  {laos && <td className="tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em] text-brand">{r.result.top4}</td>}
                  {!gov && <td className={`tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em] ${laos ? "" : "text-brand"}`}>{r.result.top3}</td>}
                  <td className="tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em]">{r.result.bottom2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
