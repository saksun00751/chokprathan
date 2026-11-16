import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { AccountArea, AccountAreaSkeleton } from "@/components/shell/account-area";
import { ActiveBottomNav, ActiveSidebarNav, BottomNav, SidebarNav } from "@/components/shell/nav";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { SiteFooter } from "@/components/shell/site-footer";
import { getI18n } from "@/i18n/rsc";

export default async function SiteLayout({ children }: LayoutProps<"/[lang]">) {
  const { t } = await getI18n();
  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Link href="/" aria-label={t.site.nav.items.home}>
            <Logo />
          </Link>
        </div>
        <Suspense fallback={<SidebarNav pathname={null} />}>
          <ActiveSidebarNav />
        </Suspense>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-3 px-4 lg:h-16 lg:px-8">
            <Link href="/" aria-label={t.site.nav.items.home} className="lg:hidden">
              <Logo nameClassName="max-sm:hidden" />
            </Link>
            <div className="flex-1" />
            <LanguageSwitcher compact />
            <Suspense fallback={<AccountAreaSkeleton />}>
              <AccountArea />
            </Suspense>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-5 pb-10 lg:px-8 lg:pt-8 lg:pb-12">
          {children}
        </main>
        <div className="pb-16 lg:pb-0">
          <SiteFooter />
        </div>
      </div>

      <Suspense fallback={<BottomNav pathname={null} />}>
        <ActiveBottomNav />
      </Suspense>
    </div>
  );
}
