import { Suspense } from "react";
import { MenuArt } from "@/components/art/scenes";
import { Rays } from "@/components/art/pieces";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatBaht } from "@/domain/money";
import { fmt, formatDate } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getNews, getPromotions } from "@/server/data/member";

export const generateMetadata = () => pageMeta("promotions");

export default async function PromotionsPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.promotions.title} description={t.info.promotions.description} />
      <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
        <PromoBody />
      </Suspense>
    </>
  );
}

async function PromoBody() {
  const [promos, news, { lang, t }] = await Promise.all([getPromotions(), getNews(5), getI18n()]);
  const pr = t.info.promotions;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
      <ul className="flex flex-col gap-3">
        {promos.map((p) => {
          const isBonus = p.kind === "bonus";
          const isCashback = p.kind === "cashback";
          const href = isBonus
            ? `/wallet/deposit?promo=${p.id}`
            : isCashback
              ? "/cashback"
              : "/affiliate";
          const art = isBonus ? "gift" : isCashback ? "envelope" : "friends";
          const bg = isBonus
            ? "radial-gradient(90% 90% at 50% 45%, var(--slide-glow) 0%, var(--slide-to) 100%)"
            : isCashback
              ? "radial-gradient(90% 90% at 50% 45%, oklch(0.6 0.2 26 / 0.85) 0%, var(--slide-to) 100%)"
              : "radial-gradient(90% 90% at 50% 45%, oklch(0.74 0.15 76 / 0.7) 0%, var(--slide-to) 100%)";
          return (
            <li key={p.id}>
              <Card className="flex flex-col overflow-hidden sm:flex-row sm:items-stretch">
                <div
                  className="relative grid h-32 shrink-0 place-items-center overflow-hidden sm:h-auto sm:w-40"
                  style={{ background: bg }}
                  aria-hidden="true"
                >
                  <Rays className="absolute size-[180%]" />
                  <MenuArt art={art} className="relative size-20 sm:size-24" />
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{p.title}</h2>
                    <p className="mt-0.5 text-sm text-ink-2">{p.summary}</p>
                    {p.details && (
                      <p className="mt-1 text-sm text-ink-3">{p.details}</p>
                    )}
                    {isBonus && (
                      <p className="tnum mt-2 text-xs text-ink-3">
                        {fmt(pr.terms, { min: formatBaht(p.min_deposit, { decimals: "auto" }), max: formatBaht(p.max_bonus, { decimals: "auto" }), x: p.turnover_x })}
                      </p>
                    )}
                  </div>
                  <ButtonLink
                    href={href}
                    variant={isBonus ? "primary" : "secondary"}
                    className="shrink-0"
                  >
                    {isBonus ? pr.claim : t.common.details}
                  </ButtonLink>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="news">
        <h2 id="news" className="mb-3 text-lg font-semibold">
          {pr.news}
        </h2>
        <Card className="divide-y divide-line">
          {news.length === 0 && <p className="px-4 py-3.5 text-sm text-ink-3">{pr.noNews}</p>}
          {news.map((n) => (
            <article key={n.id} className="px-4 py-3.5">
              <p className="text-xs text-ink-3">
                {formatDate(n.created_at, lang, "long")}
              </p>
              <h3 className="mt-0.5 font-semibold">{n.title}</h3>
              <p className="mt-1 text-sm text-ink-2">{n.body}</p>
            </article>
          ))}
        </Card>
      </section>
    </div>
  );
}
