"use client";

import Link from "next/link";
import { ChevronDown, CircleUserRound, LogOut, Receipt, Settings, Wallet } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { logoutAction } from "@/server/actions/auth";

/** The member's own menu. The back office has its own entrance (/console) and is never linked from here. */
export function AccountMenu({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        popoverTarget="account-menu"
        className="hidden h-9 items-center gap-1.5 rounded-control pr-2 pl-1.5 text-sm font-medium text-ink hover:bg-panel md:inline-flex"
      >
        <CircleUserRound className="size-6 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        <span className="max-w-32 truncate">{name}</span>
        <ChevronDown className="size-4 text-ink-3" aria-hidden="true" />
      </button>
      <div
        id="account-menu"
        popover="auto"
        className="fixed inset-auto top-[60px] right-4 m-0 w-60 rounded-card border border-line bg-surface p-1.5 shadow-float lg:right-8"
      >
        <ul className="flex flex-col">
          <MenuLink href="/account" icon={<Settings className="size-4" />}>
            {t.site.account.profile}
          </MenuLink>
          <MenuLink href="/wallet" icon={<Wallet className="size-4" />}>
            {t.site.account.wallet}
          </MenuLink>
          <MenuLink href="/bills" icon={<Receipt className="size-4" />}>
            {t.site.account.myBills}
          </MenuLink>
          <li className="my-1 border-t border-line" />
          <li>
            <form action={logoutAction}>
              <button type="submit" className="flex h-10 w-full items-center gap-2.5 rounded-control px-3 text-sm font-medium text-danger hover:bg-danger-soft">
                <LogOut className="size-4" aria-hidden="true" />
                {t.site.account.logout}
              </button>
            </form>
          </li>
        </ul>
      </div>
    </>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        onClick={() => document.getElementById("account-menu")?.hidePopover()}
        className="flex h-10 items-center gap-2.5 rounded-control px-3 text-sm font-medium text-ink hover:bg-panel"
      >
        <span className="text-ink-3" aria-hidden="true">
          {icon}
        </span>
        {children}
      </Link>
    </li>
  );
}
