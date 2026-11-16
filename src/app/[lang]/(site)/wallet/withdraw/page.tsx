import { Suspense } from "react";
import { Card, Money, PageHeader, Skeleton } from "@/components/ui/primitives";
import { maskAccount } from "@/domain/banks";
import { formatBaht } from "@/domain/money";
import { fmt, formatDateTime } from "@/i18n/format";
import { bankName } from "@/i18n/labels";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getWithdrawPage } from "@/server/data/wallet";
import { requireViewer } from "@/server/session";
import { WithdrawForm } from "./withdraw-form";

export const generateMetadata = () => pageMeta("withdraw");

export default async function WithdrawPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.withdraw.title} back={{ href: "/wallet", label: t.meta.wallet.title }} />
      <Suspense fallback={<Skeleton className="h-[420px] max-w-xl rounded-card" />}>
        <WithdrawBody />
      </Suspense>
    </>
  );
}

async function WithdrawBody() {
  const viewer = await requireViewer("/wallet/withdraw");
  const [data, { lang, t }] = await Promise.all([getWithdrawPage(viewer.id), getI18n()]);
  const w_ = t.money.withdraw;
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Card className="p-5">
        <p className="text-xs text-ink-3">{w_.available}</p>
        <Money satang={viewer.balance} className="block text-2xl font-semibold" />
        <div className="mt-4 rounded-control bg-panel px-4 py-3 text-sm">
          <p className="text-ink-3">{w_.toAccount}</p>
          <p className="font-semibold">
            {bankName(viewer.bankCode, t)} <span className="tnum">{maskAccount(viewer.bankAccount)}</span>
          </p>
          <p className="text-ink-2">{viewer.bankName}</p>
        </div>
      </Card>
      <WithdrawForm
        balance={viewer.balance}
        min={data.min}
        max={data.max}
        blocked={
          viewer.turnoverRequired > 0
            ? fmt(w_.turnoverBlocked, { amount: formatBaht(viewer.turnoverRequired) })
            : data.today >= data.perDay
              ? fmt(w_.dailyBlocked, { n: data.perDay })
              : null
        }
      />
      <p className="text-sm text-ink-3">
        {fmt(w_.limits, { perDay: data.perDay, today: data.today, min: formatBaht(data.min, { decimals: "auto" }), max: formatBaht(data.max, { decimals: "auto" }) })}
      </p>
      {data.pending.length > 0 && (
        <Card>
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{w_.pending}</h2>
          <ul className="divide-y divide-line">
            {data.pending.map((w) => (
              <li key={w.id} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-2">{formatDateTime(w.created_at, lang)}</span>
                <Money satang={w.amount} className="font-semibold" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
