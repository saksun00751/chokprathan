import { HandCoins } from "lucide-react";
import { Suspense } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Card, EmptyState, Money, PageHeader, Skeleton } from "@/components/ui/primitives";
import { fmt, formatDateTime, formatNumber } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { claimCashbackAction } from "@/server/actions/wallet";
import { getCashbackPage } from "@/server/data/member";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("cashback");

export default async function CashbackPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.cashback.title} description={t.money.cashback.description} />
      <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
        <CashbackBody />
      </Suspense>
    </>
  );
}

async function CashbackBody() {
  const viewer = await requireViewer("/cashback");
  const [{ summary, recent, cashbackBp }, { lang, t }] = await Promise.all([getCashbackPage(viewer.id), getI18n()]);
  const c = t.money.cashback;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <p className="text-sm text-ink-2">{c.available}</p>
          <Money satang={summary.balance} className="block text-[2rem] leading-tight font-semibold" />
          <ActionButton action={claimCashbackAction} size="lg" className="mt-4 w-full" disabled={summary.balance < 100}>
            {c.claim}
          </ActionButton>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-ink-3">{c.earned}</dt>
              <dd>
                <Money satang={summary.earned} className="font-semibold" />
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">{c.claimed}</dt>
              <dd>
                <Money satang={summary.claimed} className="font-semibold" />
              </dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5 text-sm text-ink-2">
          <h2 className="mb-2 font-semibold text-ink">{c.termsTitle}</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-ink-3">
            {c.terms.map((line) => (
              <li key={line}>{fmt(line, { pct: formatNumber(cashbackBp / 100) })}</li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{c.history}</h2>
        {recent.length === 0 ? (
          <EmptyState icon={<HandCoins className="size-5" />} title={c.emptyTitle} description={c.emptyBody} />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  <span className="block font-medium">{r.type === "cashback_claim" ? c.claimedRow : c.earnedRow}</span>
                  <span className="block text-xs text-ink-3">
                    {formatDateTime(r.created_at, lang)}
                    {r.ref && <span className="tnum"> · {r.ref}</span>}
                  </span>
                </span>
                <Money satang={r.amount} sign className={r.amount > 0 ? "font-semibold text-success" : "font-semibold"} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
