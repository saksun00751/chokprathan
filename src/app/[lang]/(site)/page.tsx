import Link from "next/link";
import { ArrowRight, Megaphone, Receipt, Trophy } from "lucide-react";
import { Suspense } from "react";
import { CoinStack, Coin, CoinTilt } from "@/components/art/pieces";
import { MenuArt } from "@/components/art/scenes";
import { Guilloche } from "@/components/brand/guilloche";
import { HeroSlide } from "@/components/home/hero-slide";
import { HeroSlider } from "@/components/home/hero-slider";
import { QuickMenu } from "@/components/home/quick-menu";
import { ResultInline } from "@/components/lotto/result-digits";
import { RoundCard, RoundCardSkeleton } from "@/components/lotto/round-card";
import { ButtonLink } from "@/components/ui/button";
import { ServerTimeSync } from "@/components/ui/clock";
import { Flag } from "@/components/ui/flag";
import { Card, Money, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { RateChip } from "@/components/ui/rate-chip";
import { getHomeSlides } from "@/server/data/banners";
import { getHomeData, getMemberSummary } from "@/server/data/home";
import { getLatestResults } from "@/server/data/lobby";
import { getSiteInfo } from "@/server/data/site";
import { getI18n } from "@/i18n/rsc";
import { fmt } from "@/i18n/format";
import { getViewer } from "@/server/session";

export default async function HomePage() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <Suspense fallback={<Skeleton className="h-[216px] rounded-card sm:h-[260px] lg:h-[300px]" />}>
        <HomeSlider />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 rounded-card" />}>
        <HomeTop />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-28 rounded-card" />}>
        <HomeQuick />
      </Suspense>
      <Suspense fallback={<LiveSkeleton />}>
        <HomeLive />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 rounded-card" />}>
        <HomeResults />
      </Suspense>
    </div>
  );
}

async function HomeQuick() {
  const site = await getSiteInfo();
  return <QuickMenu cashbackPct={site.cashbackPct} affPct={site.affPct} />;
}

async function HomeSlider() {
  const viewer = await getViewer();
  const { slides, serverNow } = await getHomeSlides(!!viewer);
  return (
    <>
      <ServerTimeSync serverNow={serverNow} />
      <HeroSlider
        labels={slides.map((s) => s.title.replace(/[[\]]/g, ""))}
        slides={slides.map((s, i) => (
          <HeroSlide key={s.id} slide={s} serverNow={serverNow} priority={i === 0} />
        ))}
      />
    </>
  );
}

async function HomeTop() {
  const [viewer, site, { t, lang }] = await Promise.all([getViewer(), getSiteInfo(), getI18n()]);
  const h = t.site.home;
  if (!viewer) return <GuestStrip cashbackPct={site.cashbackPct} />;
  const summary = await getMemberSummary(viewer.id);
  const announcement = (site.announcementI18n as Record<string, string>)[lang] || site.announcement;
  return (
    <div className="flex flex-col gap-3">
      {announcement && (
        <p className="flex items-start gap-2.5 rounded-control bg-brand-soft px-4 py-2.5 text-sm text-brand-soft-ink">
          <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {announcement}
        </p>
      )}
      <section aria-label={h.walletLabel} className="relative overflow-hidden rounded-card bg-brand-deep p-5 text-white sm:p-7">
        <Guilloche className="absolute -top-28 -right-32 size-[460px] text-white" strokeOpacity={0.13} />
        <div aria-hidden="true" className="pointer-events-none absolute -right-2 -bottom-3 hidden w-44 sm:block md:right-56 md:bottom-0 lg:w-52">
          <CoinStack className="w-[62%]" count={5} />
          <Coin className="absolute top-[-34%] right-[4%] w-[38%] rotate-12 motion-safe:animate-float" />
          <CoinTilt className="absolute top-[6%] right-[-10%] w-[34%] -rotate-12 motion-safe:animate-float [animation-delay:-1.6s]" />
        </div>
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-on-deep-2">{fmt(h.hello, { name: viewer.name })}</p>
            <p className="mt-3 text-sm text-on-deep-2">{h.balance}</p>
            <Money satang={viewer.balance} className="mt-0.5 block text-3xl font-semibold sm:text-[2.5rem] sm:leading-tight" />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-on-deep-2">
              <Link href="/cashback" className="hover:text-white">
                {h.cashback} <Money satang={viewer.cashbackBalance} className="font-semibold text-white" />
              </Link>
              <Link href="/affiliate" className="hover:text-white">
                {h.affiliate} <Money satang={viewer.affiliateBalance} className="font-semibold text-white" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:flex">
            <ButtonLink href="/wallet/deposit" variant="gold" size="lg">
              {t.site.account.deposit}
            </ButtonLink>
            <ButtonLink href="/wallet/withdraw" variant="onDeepGhost" size="lg">
              {t.site.account.withdraw}
            </ButtonLink>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <StatLink href="/bills" icon={<Receipt className="size-5" />} label={h.pending}>
          {fmt(h.pendingBills, { n: summary.pendingBills })} · <Money satang={summary.pendingStake} decimals="auto" />
        </StatLink>
        <StatLink href="/bills?status=won" icon={<Trophy className="size-5" />} label={h.weekWins}>
          <Money satang={summary.weekWinnings} decimals="auto" className={summary.weekWinnings > 0 ? "text-gold-text" : undefined} />
        </StatLink>
      </div>
    </div>
  );
}

function StatLink({ href, icon, label, children }: { href: string; icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-brand/40">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-ink-3">{label}</span>
        <span className="block truncate text-sm font-semibold text-ink">{children}</span>
      </span>
    </Link>
  );
}

async function GuestStrip({ cashbackPct }: { cashbackPct: string }) {
  const { t } = await getI18n();
  const g = t.site.home.guest;
  return (
    <section aria-label={t.site.account.register} className="relative flex flex-col gap-4 overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute top-3 right-3 sm:static sm:shrink-0">
        <MenuArt art="coins" className="size-16 sm:size-20" />
      </div>
      <div className="relative min-w-0 flex-1 pr-16 sm:pr-0">
        <h1 className="text-xl font-semibold tracking-tight">{g.title}</h1>
        <p className="mt-1 text-sm text-ink-2">{fmt(g.body, { cashback: cashbackPct })}</p>
      </div>
      <div className="relative flex gap-2">
        <ButtonLink href="/register" size="lg" className="flex-1 sm:flex-none">
          {t.site.account.register}
        </ButtonLink>
        <ButtonLink href="/login" variant="secondary" size="lg" className="flex-1 sm:flex-none">
          {t.site.account.login}
        </ButtonLink>
      </div>
    </section>
  );
}

async function HomeLive() {
  const [{ closingSoon, cutSamples, serverNow }, { t }] = await Promise.all([getHomeData(), getI18n()]);
  const h = t.site.home;
  return (
    <>
      <ServerTimeSync serverNow={serverNow} />
      <section aria-labelledby="closing">
        <SectionTitle
          id="closing"
          action={
            <Link href="/lotto" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
              {h.seeAll} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          {h.closingSoon}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {closingSoon.map((r) => (
            <RoundCard key={r.id} round={r} serverNow={serverNow} />
          ))}
        </div>
      </section>

      {cutSamples.length > 0 && (
        <section aria-labelledby="cuts" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
          <div>
            <h2 id="cuts" className="text-lg font-semibold">
              {h.cutsTitle}
            </h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">{h.cutsBody}</p>
            <Link href="/rules#rate-cut" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
              {h.cutsHow} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <Card className="divide-y divide-line">
            {cutSamples.map((c) => (
              <Link key={`${c.roundId}-${c.betType}-${c.number}`} href={`/lotto/${c.roundId}`} prefetch={false} className="flex items-center gap-4 px-4 py-3 hover:bg-panel">
                <span className="tnum w-14 text-xl font-semibold tracking-[0.1em]">{c.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{c.betLabel}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {c.lottoName} · {c.label}
                  </span>
                </span>
                <RateChip baseRate100={c.baseRate100} rate100={c.rate100} />
              </Link>
            ))}
          </Card>
        </section>
      )}
    </>
  );
}

async function HomeResults() {
  const [{ results }, { t }] = await Promise.all([getLatestResults(8), getI18n()]);
  const list = [...results.filter((r) => r.group !== "yiki").slice(0, 5), ...results.filter((r) => r.group === "yiki").slice(0, 1)];
  return (
    <section aria-labelledby="results">
      <SectionTitle
        id="results"
        action={
          <Link href="/results" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            {t.site.home.allResults} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      >
        {t.site.home.latestResults}
      </SectionTitle>
      <Card className="divide-y divide-line">
        {list.map((r) => (
          <Link key={r.roundId} href={`/results/${r.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
            <Flag code={r.flag} className="size-6" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{r.shortName}</span>
              <span className="block text-xs text-ink-3">{r.label}</span>
            </span>
            <ResultInline format={r.format} result={r.result} />
          </Link>
        ))}
      </Card>
    </section>
  );
}

function LiveSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <RoundCardSkeleton key={i} />
      ))}
    </div>
  );
}
