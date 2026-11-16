import Link from "next/link";
import { MenuArt, type MenuArtKey } from "@/components/art/scenes";
import { getI18n } from "@/i18n/rsc";
import { fmt } from "@/i18n/format";

type Key = "promotions" | "cashback" | "affiliate" | "results" | "vouchers" | "contact";
const ITEMS: { href: string; key: Key; art: MenuArtKey }[] = [
  { href: "/promotions", key: "promotions", art: "gift" },
  { href: "/cashback", key: "cashback", art: "envelope" },
  { href: "/affiliate", key: "affiliate", art: "friends" },
  { href: "/results", key: "results", art: "trophy" },
  { href: "/vouchers", key: "vouchers", art: "coupon" },
  { href: "/contact", key: "contact", art: "chat" },
];

/** Shortcut tiles on the home page. Percentages come from the live reward settings. */
export async function QuickMenu({ cashbackPct, affPct }: { cashbackPct: string; affPct: string }) {
  const { t } = await getI18n();
  const q = t.site.home.quick;
  return (
    <nav aria-label={q.label}>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-3 md:grid-cols-6">
        {ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="group flex h-full flex-col items-center rounded-card border border-line bg-surface px-2 pt-3 pb-3 text-center shadow-card transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-brand/40"
            >
              <MenuArt art={item.art} className="size-14 transition-transform duration-200 group-hover:scale-105 sm:size-16" />
              <span className="mt-1.5 text-sm font-semibold text-ink">{q.items[item.key].label}</span>
              <span className="text-xs text-ink-3">{fmt(q.items[item.key].sub, { cashback: cashbackPct, aff: affPct })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
