import Link from "next/link";
import { ShieldCheck, Ticket, Wallet } from "lucide-react";
import { BannerArt } from "@/components/art/scenes";
import { Guilloche } from "@/components/brand/guilloche";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { Provide } from "@/i18n/provide";
import { getI18n } from "@/i18n/rsc";

const POINT_ICONS = [Ticket, Wallet, ShieldCheck];

export default async function AuthLayout({ children }: LayoutProps<"/[lang]">) {
  const { t } = await getI18n();
  const l = t.auth.layout;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-deep text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Guilloche className="absolute -top-40 -right-56 size-[760px] text-white" strokeOpacity={0.14} />
        <Link href="/" className="relative" aria-label={l.home}>
          <Logo tone="white" />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">{l.headline}</h2>
          <ul className="mt-8 flex flex-col gap-5 text-on-deep-2">
            {l.points.map((point, i) => {
              const Icon = POINT_ICONS[i] ?? ShieldCheck;
              return (
                <li key={point} className="flex gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="relative -my-6 h-56 w-full max-w-md self-center xl:h-64">
          <BannerArt art="ticket" label={t.common.brand} />
        </div>
        <p className="relative text-sm text-on-deep-2">{l.adults}</p>
      </aside>
      <div className="flex min-h-dvh flex-col">
        <div className="flex h-16 items-center px-5 lg:px-12">
          <Link href="/" aria-label={l.home} className="lg:hidden">
            <Logo />
          </Link>
          <div className="flex-1" />
          <LanguageSwitcher />
        </div>
        <main className="flex flex-1 items-start justify-center px-5 pt-4 pb-12 lg:items-center lg:px-12">
          <div className="w-full max-w-[420px]">
            <Provide ns={["auth"]}>{children}</Provide>
          </div>
        </main>
      </div>
    </div>
  );
}
