import { notFound } from "next/navigation";
import { RotateCcw, Trophy } from "lucide-react";
import { Suspense } from "react";
import { Coin, CoinTilt } from "@/components/art/pieces";
import { ResultDigits } from "@/components/lotto/result-digits";
import { ButtonLink } from "@/components/ui/button";
import { ServerTimeSync } from "@/components/ui/clock";
import { Flag } from "@/components/ui/flag";
import { Badge, Money, PageHeader, Skeleton, TicketDivider } from "@/components/ui/primitives";
import { BET_TYPE_ORDER } from "@/core/rules/betTypes";
import { BILL_TONE } from "@/domain/labels";
import { formatBaht, formatRate } from "@/core/rules/money";
import { fmt, formatClock, formatDateTime, formatNumber } from "@/i18n/format";
import { Provide } from "@/i18n/provide";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { cn } from "@/lib/cn";
import { getMyBill } from "@/server/data/bills";
import { requireViewer } from "@/server/session";
import { CancelBill } from "./cancel-bill";

export const generateMetadata = () => pageMeta("bill");

export default async function BillPage({ params }: PageProps<"/[lang]/bills/[billId]">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.bill.title} back={{ href: "/bills", label: t.meta.bills.title }} />
      <Suspense fallback={<Skeleton className="h-[520px] max-w-2xl rounded-card" />}>
        <BillBody params={params} />
      </Suspense>
    </>
  );
}

async function BillBody({ params }: Pick<PageProps<"/[lang]/bills/[billId]">, "params">) {
  const { billId } = await params;
  const id = Number(billId);
  if (!Number.isInteger(id)) notFound();
  const viewer = await requireViewer(`/bills/${billId}`);
  const [bill, { lang, t }] = await Promise.all([getMyBill(viewer.id, id), getI18n()]);
  if (!bill) notFound();
  const bl = t.play.bill;
  const status = { tone: BILL_TONE[bill.status], label: t.lotto.billStatus[bill.status] };
  const groups = BET_TYPE_ORDER.flatMap((code) => {
    const list = bill.items.filter((i) => i.betType === code);
    return list.length ? [{ code, list }] : [];
  });

  return (
    <article className="max-w-2xl">
      <ServerTimeSync serverNow={bill.serverNow} />
      {bill.status === "won" && (
        <div className="relative mb-4 flex items-center gap-3 overflow-hidden rounded-card bg-gold px-5 py-4 text-ink [background-image:linear-gradient(100deg,transparent_30%,oklch(1_0_0/0.45)_50%,transparent_70%)] [background-size:220%_100%] motion-safe:animate-gold-sweep">
          <span aria-hidden="true" className="pointer-events-none absolute -top-3 right-24 hidden w-16 sm:block">
            <Coin className="w-10 rotate-12 motion-safe:animate-float" />
            <CoinTilt className="absolute top-8 left-9 w-9 -rotate-12 motion-safe:animate-float [animation-delay:-1.4s]" />
          </span>
          <Trophy className="size-7 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{bl.won}</p>
            <p className="text-sm text-gold-ink">{bl.paidIn}</p>
          </div>
          <Money satang={bill.totalPayout} className="ml-auto text-2xl font-semibold" />
        </div>
      )}
      <div className="rounded-card border border-line bg-surface shadow-card">
        <header className="flex items-start gap-3 p-5">
          <Flag code={bill.lotto.flag} className="size-10" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{bill.lotto.name}</h2>
            <p className="text-sm text-ink-2">
              {fmt(bl.closes, { label: bill.round.label, time: formatClock(bill.round.closesAt) })}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {bl.billNo} <span className="tnum font-semibold text-ink-2">{bill.code}</span> · {fmt(bl.sentAt, { time: formatDateTime(bill.createdAt, lang) })}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </header>

        {bill.round.result && (
          <div className="mx-5 mb-4 rounded-control bg-panel p-4">
            <p className="mb-2 text-xs font-medium text-ink-3">{bl.result}</p>
            <ResultDigits format={bill.lotto.format} result={bill.round.result} />
          </div>
        )}

        <TicketDivider />

        <div className="flex flex-col gap-4 p-5">
          {groups.map(({ code, list }) => (
            <section key={code}>
              <h3 className="mb-1.5 text-sm font-semibold">{t.lotto.betTypes[code].label}</h3>
              <ul className="divide-y divide-line rounded-control border border-line">
                {list.map((item) => (
                  <li key={item.id} className={cn("flex items-center gap-3 px-3 py-2.5", item.status === "won" && "bg-gold-soft")}>
                    <span className="tnum w-14 text-lg font-semibold tracking-[0.06em]">{item.number}</span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="tnum block">฿{formatNumber(item.stake)}</span>
                      <span className="tnum block text-xs text-ink-3">
                        {item.segments.length > 1
                          ? item.segments.map((s) => `฿${formatNumber(s.stake)} × ${formatRate(s.rate100)}`).join(" + ")
                          : fmt(bl.pays, { rate: formatRate(item.rate100) })}
                      </span>
                    </span>
                    <span className="text-right text-sm">
                      {item.status === "won" ? (
                        <span className="tnum font-semibold text-gold-text">+฿{formatBaht(item.payout, { decimals: "auto" })}</span>
                      ) : item.status === "pending" ? (
                        <span className="text-ink-3">
                          {bl.ifWin} <span className="tnum font-medium text-ink">฿{formatBaht(item.potential, { decimals: "auto" })}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">{t.lotto.billStatus[item.status]}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <TicketDivider />

        <dl className="flex flex-col gap-1.5 p-5 text-sm">
          {bill.money.packageName !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{bl.package}</dt>
              <dd className="text-right">{bill.money.standard ? bl.standard : bill.money.packageName}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-2">{bl.totalStake}</dt>
            <dd>
              <Money satang={bill.money.stake} className="font-semibold" />
            </dd>
          </div>
          {bill.money.discount > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-ink-2">{bl.discount}</dt>
                <dd className="tnum text-success">−฿{formatBaht(bill.money.discount, { decimals: "auto" })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-2">{bl.paid}</dt>
                <dd>
                  <Money satang={bill.money.paid} className="font-semibold" />
                </dd>
              </div>
            </>
          )}
          {(bill.status === "won" || bill.status === "lost") && (
            <div className="flex justify-between">
              <dt className="text-ink-2">{bl.payout}</dt>
              <dd>
                <Money satang={bill.totalPayout} className={cn("font-semibold", bill.totalPayout > 0 && "text-gold-text")} />
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {bill.cancelUntil && (
          <Provide ns={["play"]}>
            <CancelBill billId={bill.id} until={bill.cancelUntil} serverNow={bill.serverNow} />
          </Provide>
        )}
        {bill.rebetRoundId && (
          <ButtonLink href={`/lotto/${bill.rebetRoundId}?rebet=${bill.id}`} variant="secondary">
            <RotateCcw className="size-4" aria-hidden="true" />
            {bl.rebet}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}
