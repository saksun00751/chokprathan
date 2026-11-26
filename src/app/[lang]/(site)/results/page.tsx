import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Suspense } from "react";
import { ResultDigits, ResultInline } from "@/components/lotto/result-digits";
import { Flag } from "@/components/ui/flag";
import { Card, PageHeader, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { byGroup } from "@/domain/lotto-groups";
import { fmt, formatClock, formatDate, formatDateTime } from "@/i18n/format";
import { scheduledClose } from "@/i18n/labels";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getGroups } from "@/server/data/groups";
import { getLatestResults } from "@/server/data/lobby";
import { getYikiRecent } from "@/server/data/results";

export const generateMetadata = () => pageMeta("results");

export default async function ResultsPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.results.title} description={t.info.results.description} />
      <Suspense fallback={<Skeleton className="h-[600px] rounded-card" />}>
        <ResultsBody />
      </Suspense>
    </>
  );
}

async function ResultsBody() {
  const [{ results }, yiki, allGroups, { lang, t }] = await Promise.all([getLatestResults(60), getYikiRecent(12), getGroups(), getI18n()]);
  const r_ = t.info.results;
  const gov = results.find((r) => r.slug === "thai-gov");
  // Yiki has its own table below, and the government draw its own card above.
  const sections = byGroup(results.filter((r) => r.group !== "yiki" && r.slug !== "thai-gov"), allGroups);
  const labelOf = (code: string) => allGroups.find((g) => g.code === code)?.label ?? code;

  return (
    <div className="flex flex-col gap-8">
      {gov && (
        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <Flag code="TH" className="size-9" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{gov.name}</h2>
              <p className="text-sm text-ink-2">{fmt(r_.govDraw, { date: formatDate(scheduledClose(gov), lang, "long") })}</p>
            </div>
            <Link href="/results/thai-gov" className="text-sm font-semibold text-brand hover:underline">
              {r_.history}
            </Link>
          </div>
          <ResultDigits format={gov.format} result={gov.result} size="lg" />
        </Card>
      )}

      {sections.map(({ group: { code: g }, lottos: list }) => {
        return (
          <section key={g} aria-labelledby={`r-${g}`}>
            <SectionTitle id={`r-${g}`}>{labelOf(g)}</SectionTitle>
            <Card className="grid divide-y divide-line">
              {list.map((r) => (
                <Link key={r.roundId} href={`/results/${r.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
                  <Flag code={r.flag} className="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.shortName}</span>
                    <span className="block text-xs text-ink-3">
                      {fmt(r_.resultedAt, { label: r.label, time: formatClock(r.resultedAt) })}
                    </span>
                  </span>
                  <ResultInline format={r.format} result={r.result} />
                  <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
                </Link>
              ))}
            </Card>
          </section>
        );
      })}

      {yiki.length > 0 && (
        <section aria-labelledby="r-yiki">
          <SectionTitle
            id="r-yiki"
            action={
              <Link href="/results/yiki" className="text-sm font-semibold text-brand hover:underline">
                {r_.allRounds}
              </Link>
            }
          >
            {labelOf("yiki")}
          </SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-panel text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{r_.round}</th>
                  <th className="px-4 py-2.5 font-medium">{r_.resulted}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.lotto.result.top3}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.lotto.result.bottom2}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {yiki.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-medium">{r.label}</td>
                    <td className="tnum px-4 py-2.5 text-ink-2">{formatDateTime(r.closesAt, lang)}</td>
                    <td className="tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em] text-brand">{r.result.top3}</td>
                    <td className="tnum px-4 py-2.5 text-right font-semibold tracking-[0.08em]">{r.result.bottom2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}
