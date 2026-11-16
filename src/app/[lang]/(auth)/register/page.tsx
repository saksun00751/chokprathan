import Link from "next/link";
import { Suspense } from "react";
import { MenuArt } from "@/components/art/scenes";
import { Rays } from "@/components/art/pieces";
import { Skeleton } from "@/components/ui/primitives";
import { fmt } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getSiteInfo } from "@/server/data/site";
import { RegisterFlow } from "./register-flow";

export const generateMetadata = () => pageMeta("register");

export default async function RegisterPage({ searchParams }: PageProps<"/[lang]/register">) {
  const { t } = await getI18n();
  const r = t.auth.register;
  const [before, after] = fmt(r.bonus, { pct: "\u0000" }).split("\u0000");
  return (
    <>
      <div
        className="relative mb-6 flex items-center gap-4 overflow-hidden rounded-card p-4 text-white"
        style={{ background: "radial-gradient(90% 140% at 85% 50%, var(--slide-glow) 0%, var(--slide-to) 100%)" }}
      >
        <Rays className="absolute -right-24 size-80" />
        <div className="relative min-w-0 flex-1">
          <p className="text-sm text-on-deep-2">{r.newMember}</p>
          <p className="text-lg leading-snug font-semibold">
            {before}
            <span className="text-gold">20%</span>
            {after}
          </p>
          <p className="text-xs text-on-deep-2">{r.bonusTerms}</p>
        </div>
        <MenuArt art="gift" className="relative size-20 shrink-0" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
      <p className="mt-1 text-ink-2">
        {r.subtitle}{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          {r.login}
        </Link>
      </p>
      <Suspense fallback={<Skeleton className="mt-6 h-64" />}>
        <RegisterBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function RegisterBody({ searchParams }: Pick<PageProps<"/[lang]/register">, "searchParams">) {
  const [{ ref }, site, { t }] = await Promise.all([searchParams, getSiteInfo(), getI18n()]);
  if (!site.registrationOpen) {
    return <p className="mt-6 rounded-card border border-line bg-surface p-4 text-ink-2">{t.auth.register.closed}</p>;
  }
  return <RegisterFlow initialRef={typeof ref === "string" ? ref : ""} verifyPhone={site.demoMode || site.otpRequired} />;
}
