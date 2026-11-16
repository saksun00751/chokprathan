import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getI18n } from "@/i18n/rsc";
import { LanguageSwitcher } from "./language-switcher";

export async function SiteFooter() {
  const { t } = await getI18n();
  const f = t.site.footer;
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm text-ink-2">{t.meta.description}</p>
          <p className="mt-4 text-xs text-ink-3">{f.responsible}</p>
          <LanguageSwitcher className="mt-3 -ml-2" align="start" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{f.info}</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li><Link className="text-ink-2 hover:text-ink" href="/payrate">{f.payrate}</Link></li>
            <li><Link className="text-ink-2 hover:text-ink" href="/rules">{f.rules}</Link></li>
            <li><Link className="text-ink-2 hover:text-ink" href="/results">{f.results}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{f.help}</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li><Link className="text-ink-2 hover:text-ink" href="/contact">{f.contact}</Link></li>
            <li><Link className="text-ink-2 hover:text-ink" href="/promotions">{f.promotions}</Link></li>
            <li><Link className="text-ink-2 hover:text-ink" href="/register">{f.register}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
