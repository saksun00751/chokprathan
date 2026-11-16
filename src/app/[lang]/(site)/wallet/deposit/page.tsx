import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui/primitives";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getDepositPage } from "@/server/data/wallet";
import { requireViewer } from "@/server/session";
import { DepositFlow } from "./deposit-flow";

export const generateMetadata = () => pageMeta("deposit");

export default async function DepositPage({ searchParams }: PageProps<"/[lang]/wallet/deposit">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.deposit.title} back={{ href: "/wallet", label: t.meta.wallet.title }} />
      <Suspense fallback={<Skeleton className="h-[480px] max-w-xl rounded-card" />}>
        <DepositBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DepositBody({ searchParams }: Pick<PageProps<"/[lang]/wallet/deposit">, "searchParams">) {
  const [{ promo }, viewer] = await Promise.all([searchParams, requireViewer("/wallet/deposit")]);
  const data = await getDepositPage(viewer.id);
  return <DepositFlow data={data} initialPromo={typeof promo === "string" ? Number(promo) : null} bankCode={viewer.bankCode} bankName={viewer.bankName} />;
}
