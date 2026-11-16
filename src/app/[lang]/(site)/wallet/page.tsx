import Link from "next/link";
import { ArrowRight, Hourglass, Sparkles } from "lucide-react";
import { Suspense } from "react";
import { Guilloche } from "@/components/brand/guilloche";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, Money, PageHeader, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { TxList } from "@/components/wallet/tx-list";
import { maskAccount } from "@/domain/banks";
import { formatBaht } from "@/domain/money";
import { fmt, formatDateTime } from "@/i18n/format";
import { bankShort } from "@/i18n/labels";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getWalletOverview } from "@/server/data/wallet";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("wallet");

const DEPOSIT_TONE = { awaiting: "warning", pending: "brand", approved: "success", rejected: "danger", expired: "outline" } as const;
const WITHDRAW_TONE = { pending: "brand", approved: "success", rejected: "danger" } as const;

export default async function WalletPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.wallet.title} />
      <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
        <WalletBody />
      </Suspense>
    </>
  );
}

async function WalletBody() {
  const viewer = await requireViewer("/wallet");
  const [{ withdrawals, deposits, recent, points, pointRule }, { lang, t }] = await Promise.all([getWalletOverview(viewer.id), getI18n()]);
  const w_ = t.money.wallet;
  const pendingDeposits = deposits.filter((d) => d.status === "pending" || d.status === "awaiting");
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        <section aria-label={w_.balanceLabel} className="relative overflow-hidden rounded-card bg-brand-deep p-5 text-white sm:p-6">
          <Guilloche className="absolute -top-24 -right-28 size-[420px] text-white" strokeOpacity={0.13} />
          <div className="relative">
            <p className="text-sm text-on-deep-2">{w_.balance}</p>
            <Money satang={viewer.balance} className="mt-1 block text-[2rem] leading-tight font-semibold" />
            <p className="mt-2 text-sm text-on-deep-2">
              {fmt(w_.payoutTo, { bank: bankShort(viewer.bankCode, t), account: maskAccount(viewer.bankAccount), name: viewer.bankName ?? "" })}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ButtonLink href="/wallet/deposit" variant="onDeep" size="lg">
                {w_.deposit}
              </ButtonLink>
              <ButtonLink href="/wallet/withdraw" variant="onDeepGhost" size="lg">
                {w_.withdraw}
              </ButtonLink>
            </div>
          </div>
        </section>

        {viewer.turnoverRequired > 0 && (
          <p className="flex items-start gap-2.5 rounded-control bg-warning-soft px-4 py-3 text-sm text-warning">
            <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{fmt(w_.turnover, { amount: `฿${formatBaht(viewer.turnoverRequired)}` })}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link href="/cashback" className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-brand/40">
            <p className="text-xs text-ink-3">{w_.cashbackWallet}</p>
            <Money satang={viewer.cashbackBalance} className="mt-0.5 block text-lg font-semibold" />
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              {w_.claimToMain} <ArrowRight className="size-3" aria-hidden="true" />
            </p>
          </Link>
          <Link href="/affiliate" className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-brand/40">
            <p className="text-xs text-ink-3">{w_.affiliateWallet}</p>
            <Money satang={viewer.affiliateBalance} className="mt-0.5 block text-lg font-semibold" />
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              {w_.transferToMain} <ArrowRight className="size-3" aria-hidden="true" />
            </p>
          </Link>
        </div>

        {(pointRule.enabled || points.points > 0) && (
          <Card>
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="size-4 text-gold-text" aria-hidden="true" />
                  {w_.points}
                </h2>
                {pointRule.enabled && (
                  <p className="mt-0.5 text-xs text-ink-3">
                    {fmt(w_.pointsRule, { amount: formatBaht(pointRule.every, { decimals: "auto" }), n: pointRule.points.toLocaleString("en-US") })}
                  </p>
                )}
              </div>
              <p className="text-right">
                <span className="tnum text-2xl leading-none font-semibold">{points.points.toLocaleString("en-US")}</span>
                <span className="ml-1 text-sm text-ink-3">{w_.pointsUnit}</span>
              </p>
            </div>
            {points.moves.length === 0 ? (
              <p className="border-t border-line px-4 py-3 text-sm text-ink-3">{w_.pointsEmpty}</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {points.moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>
                      <span className="block font-medium">{w_.pointKinds[m.kind as keyof typeof w_.pointKinds] ?? m.kind}</span>
                      <span className="block text-xs text-ink-3">{formatDateTime(m.created_at, lang)}</span>
                    </span>
                    <span className={`tnum font-semibold ${m.amount > 0 ? "text-success" : "text-danger"}`}>
                      {m.amount > 0 ? "+" : ""}
                      {Number(m.amount).toLocaleString("en-US")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {(pendingDeposits.length > 0 || pendingWithdrawals.length > 0) && (
          <Card>
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{w_.inProgress}</h2>
            <ul className="divide-y divide-line">
              {pendingDeposits.map((d) => (
                <li key={`d${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block text-sm font-medium">{w_.deposit}</span>
                    <span className="block text-xs text-ink-3">{formatDateTime(d.createdAt, lang)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money satang={d.amount} className="text-sm font-semibold" />
                    <Badge tone={DEPOSIT_TONE[d.status]}>{t.money.depositStatus[d.status]}</Badge>
                  </span>
                </li>
              ))}
              {pendingWithdrawals.map((w) => (
                <li key={`w${w.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block text-sm font-medium">{w_.withdraw}</span>
                    <span className="block text-xs text-ink-3">{formatDateTime(w.created_at, lang)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money satang={w.amount} className="text-sm font-semibold" />
                    <Badge tone={WITHDRAW_TONE[w.status]}>{t.money.withdrawStatus[w.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <section aria-labelledby="recent">
        <SectionTitle
          id="recent"
          action={
            <span className="flex items-center gap-4">
              <Link href="/wallet/games" className="text-sm font-semibold text-brand hover:underline">
                {w_.gameHistory}
              </Link>
              <Link href="/wallet/transactions" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                {w_.seeAll} <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </span>
          }
        >
          {w_.recent}
        </SectionTitle>
        <Card>
          <TxList rows={recent} />
        </Card>
      </section>
    </div>
  );
}
