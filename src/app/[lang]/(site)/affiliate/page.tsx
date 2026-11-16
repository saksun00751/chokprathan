import { headers } from "next/headers";
import { Users } from "lucide-react";
import { Suspense } from "react";
import { ActionButton, CopyButton } from "@/components/ui/action-button";
import { Badge, Card, EmptyState, Money, PageHeader, Skeleton } from "@/components/ui/primitives";
import { maskPhone } from "@/domain/banks";
import { fmt, formatDate, formatNumber } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { transferAffiliateAction } from "@/server/actions/wallet";
import { getAffiliatePage } from "@/server/data/member";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("affiliate");

export default async function AffiliatePage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.affiliate.title} description={t.money.affiliate.description} />
      <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
        <AffiliateBody />
      </Suspense>
    </>
  );
}

async function AffiliateBody() {
  const [viewer, h] = await Promise.all([requireViewer("/affiliate"), headers()]);
  const [{ summary, downlines, aff1Bp, aff2Bp }, { lang, t }] = await Promise.all([getAffiliatePage(viewer.id), getI18n()]);
  const a = t.money.affiliate;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/register?ref=${viewer.refCode}`;
  const shareText = a.shareText;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold">{a.link}</p>
          <div className="mt-2 flex items-center gap-2 rounded-control bg-panel p-2 pl-3">
            <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{link}</span>
            <CopyButton text={link} label={a.copyLink} />
          </div>
          <p className="mt-2 text-sm text-ink-3">
            {a.code} <span className="tnum font-semibold text-ink">{viewer.refCode}</span>
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm font-semibold">
            <a className="flex h-10 items-center justify-center rounded-control bg-[oklch(0.63_0.18_145)] text-white" href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
              LINE
            </a>
            <a className="flex h-10 items-center justify-center rounded-control bg-[oklch(0.5_0.16_260)] text-white" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
              Facebook
            </a>
            <a className="flex h-10 items-center justify-center rounded-control bg-[oklch(0.6_0.13_235)] text-white" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm text-ink-2">{a.available}</p>
          <Money satang={summary.balance} className="block text-[2rem] leading-tight font-semibold" />
          <ActionButton action={transferAffiliateAction} size="lg" className="mt-4 w-full" disabled={summary.balance < 100}>
            {a.transfer}
          </ActionButton>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
            <Stat label={a.clicks} value={formatNumber(summary.clicks)} />
            <Stat label={a.earned} value={<Money satang={summary.earned} />} />
            <Stat label={fmt(a.tier, { n: 1, pct: formatNumber(aff1Bp / 100) })} value={fmt(a.people, { n: formatNumber(summary.tier1) })} sub={<>{a.turnover} <Money satang={summary.tier1Turnover} decimals="auto" /></>} />
            <Stat label={fmt(a.tier, { n: 2, pct: formatNumber(aff2Bp / 100) })} value={fmt(a.people, { n: formatNumber(summary.tier2) })} sub={<>{a.turnover} <Money satang={summary.tier2Turnover} decimals="auto" /></>} />
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{a.friends}</h2>
        {downlines.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title={a.emptyTitle} description={a.emptyBody} />
        ) : (
          <ul className="divide-y divide-line">
            {downlines.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="tnum block font-medium">{maskPhone(d.phone)}</span>
                  <span className="block text-xs text-ink-3">{fmt(a.joined, { date: formatDate(d.created_at, lang) })}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-right text-xs text-ink-3">
                    {a.turnover}
                    <Money satang={d.turnover ?? 0} decimals="auto" className="block text-sm font-semibold text-ink" />
                  </span>
                  <Badge tone={d.tier === 1 ? "brand" : "neutral"}>{fmt(a.tierBadge, { n: d.tier })}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="tnum font-semibold">{value}</dd>
      {sub && <dd className="text-xs text-ink-3">{sub}</dd>}
    </div>
  );
}
