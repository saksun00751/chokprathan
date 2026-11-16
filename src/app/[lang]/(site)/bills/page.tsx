import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Suspense } from "react";
import { MenuArt } from "@/components/art/scenes";
import { ButtonLink } from "@/components/ui/button";
import { Flag } from "@/components/ui/flag";
import { Badge, Card, EmptyState, Money, PageHeader, Skeleton, TabLinks } from "@/components/ui/primitives";
import { BILL_TONE } from "@/domain/labels";
import { fmt, formatDateTime } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getMyBills, type BillFilter } from "@/server/data/bills";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("bills");

const FILTERS: BillFilter[] = ["all", "pending", "won", "lost", "void"];

export default async function BillsPage({ searchParams }: PageProps<"/[lang]/bills">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.bills.title} description={t.play.bills.description} />
      <Suspense fallback={<BillsSkeleton />}>
        <BillsBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function BillsBody({ searchParams }: Pick<PageProps<"/[lang]/bills">, "searchParams">) {
  const [{ status }, viewer, { lang, t }] = await Promise.all([searchParams, requireViewer("/bills"), getI18n()]);
  const b_ = t.play.bills;
  const filter = FILTERS.find((f) => f === status) ?? "all";
  const { bills, counts } = await getMyBills(viewer.id, filter);

  return (
    <>
      <TabLinks
        label={b_.filterLabel}
        className="mb-5"
        items={FILTERS.map((f) => ({
          href: f === "all" ? "/bills" : `/bills?status=${f}`,
          label: b_.filters[f],
          active: f === filter,
          count: counts[f],
        }))}
      />
      {bills.length === 0 ? (
        <Card>
          <EmptyState
            art={<MenuArt art="ticket" className="size-20" />}
            title={filter === "all" ? b_.emptyAll : b_.emptyFilter}
            description={b_.emptyBody}
            action={<ButtonLink href="/lotto">{b_.pickLotto}</ButtonLink>}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {bills.map((b) => {
            const status = { tone: BILL_TONE[b.status], label: t.lotto.billStatus[b.status] };
            return (
              <Link key={b.id} href={`/bills/${b.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-panel">
                <Flag code={b.flag} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                    {b.lottoName}
                    <span className="font-normal text-ink-3">{b.roundLabel}</span>
                  </p>
                  <p className="tnum truncate text-sm tracking-[0.04em] text-ink-2">{b.preview}</p>
                  <p className="text-xs text-ink-3">
                    {fmt(b_.meta, { code: b.code, time: formatDateTime(b.createdAt, lang), n: b.itemCount })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {b.status === "won" ? (
                    <Money satang={b.totalPayout} sign className="text-sm font-semibold text-gold-text" />
                  ) : (
                    <Money satang={b.totalStake} decimals="auto" className="text-sm text-ink-2" />
                  )}
                </div>
                <ChevronRight className="hidden size-4 text-ink-3 sm:block" aria-hidden="true" />
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}

function BillsSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="mb-5 h-11 w-full max-w-xl" />
      <Card className="divide-y divide-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
