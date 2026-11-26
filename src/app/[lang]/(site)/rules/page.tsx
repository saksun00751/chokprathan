import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import type { BetTypeCode } from "chokprathan-core/rules/types";
import { formatBaht, formatRate, payoutOf } from "chokprathan-core/rules/money";
import { priceStake } from "chokprathan-core/rules/pricing";
import { fmt, formatNumber } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getRateTables } from "@/server/data/results";
import { getSiteInfo } from "@/server/data/site";

export const generateMetadata = () => pageMeta("rules");

const BET_ORDER: BetTypeCode[] = ["top4", "top3", "tod3", "front3", "bottom3", "top2", "bottom2", "runTop", "runBottom"];

export default async function RulesPage() {
  const { t } = await getI18n();
  const r = t.info.rules;
  return (
    <>
      <PageHeader title={t.meta.rules.title} description={r.description} />
      <div className="flex max-w-3xl flex-col gap-10 leading-relaxed">
        <section aria-labelledby="how">
          <h2 id="how" className="text-lg font-semibold">
            {r.howTitle}
          </h2>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-ink-2 marker:text-ink-3">
            {r.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="types">
          <h2 id="types" className="text-lg font-semibold">
            {r.typesTitle}
          </h2>
          <p className="mt-2 text-ink-2">
            {r.typesBody}{" "}
            <Link href="/payrate" className="font-semibold text-brand hover:underline">
              {r.payrateLink}
            </Link>
          </p>
          <Card className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-panel text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{r.type}</th>
                  <th className="px-4 py-2.5 font-medium">{r.winsWhen}</th>
                  <th className="px-4 py-2.5 font-medium">{r.example}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {BET_ORDER.map((code) => (
                  <tr key={code}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{t.lotto.betTypes[code].label}</td>
                    <td className="px-4 py-2.5 text-ink-2">{r.betRules[code].rule}</td>
                    <td className="px-4 py-2.5 text-ink-2">{r.betRules[code].example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <section aria-labelledby="discount">
          <h2 id="discount" className="text-lg font-semibold">
            {r.discountTitle}
          </h2>
          <p className="mt-2 text-ink-2">{r.discountBody}</p>
        </section>

        <section aria-labelledby="draws">
          <h2 id="draws" className="text-lg font-semibold">
            {r.drawsTitle}
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-ink-2 marker:text-ink-3">
            {r.draws.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <Suspense fallback={<Skeleton className="h-72 rounded-card" />}>
          <RateCutSection />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-32 rounded-card" />}>
          <CancelSection />
        </Suspense>

        <section aria-labelledby="money">
          <h2 id="money" className="text-lg font-semibold">
            {r.moneyTitle}
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-ink-2 marker:text-ink-3">
            {r.money.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="mindful" className="rounded-card bg-panel p-5">
          <h2 id="mindful" className="font-semibold">
            {r.mindfulTitle}
          </h2>
          <p className="mt-2 text-ink-2">{r.mindfulBody}</p>
        </section>
      </div>
    </>
  );
}

async function RateCutSection() {
  const [{ tiers }, { t }] = await Promise.all([getRateTables(), getI18n()]);
  const r = t.info.rules;
  const top3 = tiers.find((x) => x.code === "top3");
  const base = 95000;
  const profile = top3?.profile;
  const first = profile?.tiers[0];
  const example = profile && first ? priceStake({ baseRate100: base, profile, manual: null, currentTotal: first.threshold - 200, stake: 500 }) : null;

  return (
    <section aria-labelledby="rate-cut-title" id="rate-cut" className="scroll-mt-24">
      <h2 id="rate-cut-title" className="text-lg font-semibold">
        {r.rateCutTitle}
      </h2>
      <p className="mt-2 text-ink-2">{r.rateCutBody}</p>
      {example?.ok && first && (
        <Card className="mt-4 p-5">
          <p className="text-sm font-semibold">{fmt(r.rateCutExample, { rate: formatRate(base) })}</p>
          <p className="mt-1 text-sm text-ink-2">
            {fmt(r.rateCutCase, { total: formatNumber(first.threshold - 200), threshold: formatNumber(first.threshold), percent: first.percent })}
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {example.segments.map((s, i) => (
              <li key={i} className="tnum flex justify-between rounded-[8px] bg-panel px-3 py-2">
                <span>
                  ฿{formatNumber(s.stake)} × {formatRate(s.rate100)}
                </span>
                <span className="font-semibold">฿{formatBaht(s.stake * s.rate100, { decimals: "auto" })}</span>
              </li>
            ))}
          </ul>
          <p className="tnum mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold">
            <span>{r.ifWin}</span>
            <span>฿{formatBaht(payoutOf(example.segments), { decimals: "auto" })}</span>
          </p>
        </Card>
      )}
    </section>
  );
}

async function CancelSection() {
  const [site, { t }] = await Promise.all([getSiteInfo(), getI18n()]);
  return (
    <section aria-labelledby="cancel">
      <h2 id="cancel" className="text-lg font-semibold">
        {t.info.rules.cancelTitle}
      </h2>
      <p className="mt-2 text-ink-2">{fmt(t.info.rules.cancelBody, { min: site.cancelWindowMin })}</p>
      {site.cancelCutoffMin > 0 && <p className="mt-2 text-ink-2">{fmt(t.info.rules.cancelCutoff, { min: site.cancelCutoffMin })}</p>}
    </section>
  );
}
