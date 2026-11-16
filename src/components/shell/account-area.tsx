import Link from "next/link";
import { Wallet } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Money, Skeleton } from "@/components/ui/primitives";
import { getI18n } from "@/i18n/rsc";
import { getViewer } from "@/server/session";
import { AccountMenu } from "./account-menu";
import { SessionWatch } from "./session-watch";

export async function AccountArea() {
  const [viewer, { t }] = await Promise.all([getViewer(), getI18n()]);
  if (!viewer) {
    return (
      <div className="flex items-center gap-2">
        <ButtonLink href="/login" variant="secondary" size="sm">
          {t.site.account.login}
        </ButtonLink>
        <ButtonLink href="/register" size="sm">
          {t.site.account.register}
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/wallet"
        className="flex h-9 items-center gap-2 rounded-full bg-brand-soft pr-3.5 pl-2.5 text-brand-soft-ink transition-colors hover:bg-[oklch(0.93_0.035_285)]"
        aria-label={t.site.account.balanceLabel}
      >
        <Wallet className="size-4" aria-hidden="true" />
        <Money satang={viewer.balance} className="text-sm font-semibold" />
      </Link>
      <div className="hidden gap-2 md:flex">
        <ButtonLink href="/wallet/deposit" size="sm">
          {t.site.account.deposit}
        </ButtonLink>
        <ButtonLink href="/wallet/withdraw" variant="secondary" size="sm">
          {t.site.account.withdraw}
        </ButtonLink>
      </div>
      <AccountMenu name={viewer.name || viewer.phone || t.site.account.member} />
      <SessionWatch door="member" />
    </div>
  );
}

export function AccountAreaSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Skeleton className="h-9 w-28 rounded-full" />
      <Skeleton className="hidden h-9 w-20 md:block" />
    </div>
  );
}
