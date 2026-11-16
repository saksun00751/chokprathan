import { Suspense } from "react";
import { Card, PageHeader, Skeleton, TabLinks } from "@/components/ui/primitives";
import { TxList } from "@/components/wallet/tx-list";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getTransactions, type TxFilter } from "@/server/data/wallet";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("transactions");

const FILTERS: TxFilter[] = ["all", "money", "bets", "rewards"];

export default async function TransactionsPage({ searchParams }: PageProps<"/[lang]/wallet/transactions">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.transactions.title} description={t.money.transactions.description} back={{ href: "/wallet", label: t.meta.wallet.title }} />
      <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
        <TxBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TxBody({ searchParams }: Pick<PageProps<"/[lang]/wallet/transactions">, "searchParams">) {
  const [{ type }, viewer, { t }] = await Promise.all([searchParams, requireViewer("/wallet/transactions"), getI18n()]);
  const filter = FILTERS.find((f) => f === type) ?? "all";
  const rows = await getTransactions(viewer.id, filter, 200);
  const tr = t.money.transactions;
  return (
    <>
      <TabLinks
        label={tr.filterLabel}
        className="mb-5"
        items={FILTERS.map((f) => ({ href: f === "all" ? "/wallet/transactions" : `/wallet/transactions?type=${f}`, label: tr.filters[f], active: f === filter }))}
      />
      <Card>
        <TxList rows={rows} />
      </Card>
    </>
  );
}
