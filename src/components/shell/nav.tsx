"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  CircleUserRound,
  Gamepad2,
  Gift,
  HandCoins,
  History,
  House,
  MessageCircle,
  Percent,
  Receipt,
  ScrollText,
  Sparkles,
  Ticket,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/client";
import { stripLocale } from "@/i18n/config";
import type { Dict } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";

type NavKey = keyof Dict["site"]["nav"]["items"];
type NavItem = { href: string; key: NavKey; icon: LucideIcon };

const GROUPS: { key: keyof Dict["site"]["nav"]["groups"]; items: NavItem[] }[] = [
  {
    key: "play",
    items: [
      { href: "/", key: "home", icon: House },
      { href: "/lotto", key: "lotto", icon: Ticket },
      { href: "/bills", key: "myBills", icon: Receipt },
      { href: "/results", key: "results", icon: Trophy },
      { href: "/games", key: "games", icon: Gamepad2 },
    ],
  },
  {
    key: "wallet",
    items: [
      { href: "/wallet", key: "depositWithdraw", icon: Wallet },
      { href: "/wallet/transactions", key: "transactions", icon: History },
    ],
  },
  {
    key: "perks",
    items: [
      { href: "/promotions", key: "promotions", icon: Gift },
      { href: "/activities", key: "activities", icon: Sparkles },
      { href: "/cashback", key: "cashback", icon: HandCoins },
      { href: "/affiliate", key: "affiliate", icon: Users },
      { href: "/vouchers", key: "vouchers", icon: BadgePercent },
    ],
  },
  {
    key: "help",
    items: [
      { href: "/payrate", key: "payrate", icon: Percent },
      { href: "/rules", key: "rules", icon: ScrollText },
      { href: "/contact", key: "contact", icon: MessageCircle },
    ],
  },
];

const BOTTOM: NavItem[] = [
  { href: "/", key: "home", icon: House },
  { href: "/lotto", key: "lotto", icon: Ticket },
  { href: "/bills", key: "bills", icon: Receipt },
  { href: "/results", key: "results", icon: Trophy },
  { href: "/account", key: "account", icon: CircleUserRound },
];

function isActive(rawPathname: string | null, href: string) {
  if (!rawPathname) return false;
  const pathname = stripLocale(rawPathname);
  if (href === "/") return pathname === "/";
  if (href === "/wallet") return pathname === "/wallet" || pathname.startsWith("/wallet/deposit") || pathname.startsWith("/wallet/withdraw");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ pathname }: { pathname: string | null }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.site.nav.mainLabel} className="flex-1 overflow-y-auto px-3 pb-6">
      {GROUPS.map((group) => (
        <div key={group.key} className="mt-5 first:mt-2">
          <p className="px-3 pb-1.5 text-xs font-medium text-ink-3">{t.site.nav.groups[group.key]}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors",
                      active ? "bg-brand-soft text-brand-soft-ink" : "text-ink-2 hover:bg-panel hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-5 shrink-0", active ? "text-brand" : "text-ink-3")} strokeWidth={1.75} aria-hidden="true" />
                    {t.site.nav.items[item.key]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ActiveSidebarNav() {
  return <SidebarNav pathname={usePathname()} />;
}

export function BottomNav({ pathname }: { pathname: string | null }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.site.nav.quickLabel} className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-surface shadow-bar lg:hidden">
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {BOTTOM.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-brand-soft-ink" : "text-ink-3",
                )}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-brand-soft")}>
                  <Icon className={cn("size-5", active && "text-brand")} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="max-w-full truncate px-0.5">{t.site.nav.items[item.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ActiveBottomNav() {
  return <BottomNav pathname={usePathname()} />;
}
