import { MessageCircle, Phone } from "lucide-react";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getSiteInfo } from "@/server/data/site";

export const generateMetadata = () => pageMeta("contact");

export default async function ContactPage() {
  const { t } = await getI18n();
  const c = t.info.contact;
  return (
    <>
      <PageHeader title={t.meta.contact.title} description={c.description} />
      <div className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
        <Suspense fallback={<Skeleton className="h-40 rounded-card" />}>
          <Channels />
        </Suspense>
        <section aria-labelledby="faq">
          <h2 id="faq" className="mb-3 text-lg font-semibold">
            {c.faqTitle}
          </h2>
          <Card className="divide-y divide-line">
            {c.faq.map(({ q, a }) => (
              <details key={q} className="group px-4 py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium">
                  {q}
                  <span className="text-ink-3 transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="pb-3 text-sm text-ink-2">{a}</p>
              </details>
            ))}
          </Card>
        </section>
      </div>
    </>
  );
}

async function Channels() {
  const [site, { t }] = await Promise.all([getSiteInfo(), getI18n()]);
  return (
    <Card className="divide-y divide-line">
      <a href={`https://line.me/R/ti/p/${encodeURIComponent(site.lineId)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-4 hover:bg-panel">
        <span className="grid size-11 place-items-center rounded-full bg-success-soft text-success" aria-hidden="true">
          <MessageCircle className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block font-semibold">LINE</span>
          <span className="block text-sm text-ink-2">{site.lineId}</span>
        </span>
      </a>
      <a href={`tel:${site.phone.replace(/\D/g, "")}`} className="flex items-center gap-3 px-4 py-4 hover:bg-panel">
        <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          <Phone className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block font-semibold">{t.info.contact.call}</span>
          <span className="tnum block text-sm text-ink-2">{site.phone}</span>
        </span>
      </a>
    </Card>
  );
}
