import { Suspense } from "react";
import { Card, EmptyState, Money, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatDateTime } from "@/i18n/format";
import { Provide } from "@/i18n/provide";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getVoucherHistory } from "@/server/data/member";
import { requireViewer } from "@/server/session";
import { RedeemForm } from "./redeem-form";

export const generateMetadata = () => pageMeta("vouchers");

export default async function VouchersPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.vouchers.title} description={t.money.vouchers.description} />
      <div className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="p-5">
          <Provide ns={["money"]}>
            <RedeemForm />
          </Provide>
        </Card>
        <Suspense fallback={<Skeleton className="h-48 rounded-card" />}>
          <History />
        </Suspense>
      </div>
    </>
  );
}

async function History() {
  const viewer = await requireViewer("/vouchers");
  const [rows, { lang, t }] = await Promise.all([getVoucherHistory(viewer.id), getI18n()]);
  const v = t.money.vouchers;
  return (
    <Card>
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{v.used}</h2>
      {rows.length === 0 ? (
        <EmptyState title={v.emptyTitle} description={v.emptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={`${r.code}-${r.created_at}`} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="tnum block font-semibold">{r.code}</span>
                <span className="block text-xs text-ink-3">{formatDateTime(r.created_at, lang)}</span>
              </span>
              <Money satang={r.value} sign className="font-semibold text-success" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
