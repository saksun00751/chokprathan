import Link from "next/link";
import { Suspense } from "react";
import { Flag } from "@/components/ui/flag";
import { Card, PageHeader, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { GROUP_ORDER } from "@/domain/labels";
import { formatRate } from "@/domain/money";
import { fmt, formatNumber } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getRateTables } from "@/server/data/results";

export const generateMetadata = () => pageMeta("payrate");

export default async function PayratePage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.payrate.title} description={t.info.payrate.description} />
      <Suspense fallback={<Skeleton className="h-[600px] rounded-card" />}>
        <PayrateBody />
      </Suspense>
    </>
  );
}

async function PayrateBody() {
  const [{ rows, codes, tiers, limits }, { t }] = await Promise.all([getRateTables(), getI18n()]);
  const p = t.info.payrate;
  return (
    <div className="flex flex-col gap-10">
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-panel text-left text-xs text-ink-3">
            <tr>
              <th className="sticky left-0 bg-panel px-4 py-3 font-medium">{p.lotto}</th>
              {codes.map((c) => (
                <th key={c} className="px-3 py-3 text-right font-medium whitespace-nowrap">
                  {t.lotto.betTypes[c].label}
                </th>
              ))}
            </tr>
          </thead>
          {GROUP_ORDER.map((g) => {
            const list = rows.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <tbody key={g} className="divide-y divide-line">
                <tr>
                  <th colSpan={codes.length + 1} className="bg-canvas px-4 py-2 text-left text-xs font-semibold text-ink-2">
                    {t.lotto.groups[g]}
                  </th>
                </tr>
                {list.map((r) => (
                  <tr key={r.slug}>
                    <td className="sticky left-0 bg-surface px-4 py-2.5">
                      <span className="flex items-center gap-2 font-medium whitespace-nowrap">
                        <Flag code={r.flag} className="size-5" />
                        {r.name}
                      </span>
                    </td>
                    {codes.map((c) => (
                      <td key={c} className="tnum px-3 py-2.5 text-right">
                        {r.rates[c] !== undefined ? <b className="font-semibold">{formatRate(r.rates[c]!)}</b> : <span className="text-ink-3">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </Card>

      <section aria-labelledby="tiers" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <SectionTitle id="tiers">{p.tiersTitle}</SectionTitle>
          <p className="max-w-[60ch] text-ink-2">{p.tiersBody}</p>
          <p className="mt-3 text-sm text-ink-3">{fmt(p.limits, { min: formatNumber(limits.minStake), max: formatNumber(limits.maxPerBill) })}</p>
          <Link href="/rules#rate-cut" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
            {p.example}
          </Link>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-panel text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">{p.type}</th>
                <th className="px-4 py-2.5 font-medium">{p.whenTotal}</th>
                <th className="px-4 py-2.5 text-right font-medium">{p.closesAt}</th>
                <th className="px-4 py-2.5 text-right font-medium">{p.maxPer}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tiers.map((row) => (
                <tr key={row.code}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.label}</td>
                  <td className="px-4 py-2.5">
                    {row.profile.enabled && row.profile.tiers.length ? (
                      <ul className="flex flex-col gap-0.5">
                        {row.profile.tiers.map((tier) => (
                          <li key={tier.threshold} className="tnum whitespace-nowrap">
                            {fmt(p.tier, { threshold: formatNumber(tier.threshold), percent: tier.percent })}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-ink-3">{p.noCut}</span>
                    )}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {row.profile.enabled && row.profile.cap !== null ? `฿${formatNumber(row.profile.cap)}` : "-"}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">฿{formatNumber(row.maxPerNumber)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
