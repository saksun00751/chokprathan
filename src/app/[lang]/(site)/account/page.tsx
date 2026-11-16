import Link from "next/link";
import {
  BadgePercent,
  ChevronRight,
  Gift,
  HandCoins,
  History,
  ListChecks,
  LogOut,
  MessageCircle,
  Percent,
  ScrollText,
  Users,
  Wallet,
} from "lucide-react";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import { maskAccount } from "@/domain/banks";
import { formatDate } from "@/i18n/format";
import { bankName } from "@/i18n/labels";
import { Provide } from "@/i18n/provide";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { logoutAction } from "@/server/actions/auth";
import { requireViewer } from "@/server/session";
import { PasswordForm } from "./password-form";

export const generateMetadata = () => pageMeta("account");

const LINKS = [
  { href: "/wallet", key: "wallet", icon: Wallet },
  { href: "/wallet/transactions", key: "transactions", icon: History },
  { href: "/numbersets", key: "numbersets", icon: ListChecks },
  { href: "/affiliate", key: "affiliate", icon: Users },
  { href: "/cashback", key: "cashback", icon: HandCoins },
  { href: "/vouchers", key: "vouchers", icon: BadgePercent },
  { href: "/promotions", key: "promotions", icon: Gift },
  { href: "/payrate", key: "payrate", icon: Percent },
  { href: "/rules", key: "rules", icon: ScrollText },
  { href: "/contact", key: "contact", icon: MessageCircle },
] as const;

export default async function AccountPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.account.title} />
      <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
        <AccountBody />
      </Suspense>
    </>
  );
}

async function AccountBody() {
  const [viewer, { lang, t }] = await Promise.all([requireViewer("/account"), getI18n()]);
  const a = t.auth.account;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <p className="text-lg font-semibold">{viewer.name}</p>
          <p className="tnum text-ink-2">{viewer.phone ?? viewer.username}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-ink-3">{a.since}</dt>
              <dd className="font-medium">{formatDate(viewer.createdAt, lang, "long")}</dd>
            </div>
            <div>
              <dt className="text-ink-3">{a.refCode}</dt>
              <dd className="tnum font-semibold">{viewer.refCode}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-3">{a.payout}</dt>
              <dd className="font-medium">
                {bankName(viewer.bankCode, t)} <span className="tnum">{maskAccount(viewer.bankAccount)}</span> · {viewer.bankName}
              </dd>
              <dd className="mt-1 text-xs text-ink-3">{a.payoutHint}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <ul className="divide-y divide-line">
            {LINKS.map(({ href, key, icon: Icon }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-panel">
                  <Icon className="size-5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
                  <span className="flex-1">{a.links[key]}</span>
                  <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">{a.changePassword}</h2>
          <Provide ns={["auth"]}>
            <PasswordForm />
          </Provide>
        </Card>
        <form action={logoutAction}>
          <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface font-semibold text-danger hover:bg-danger-soft">
            <LogOut className="size-5" aria-hidden="true" />
            {a.logout}
          </button>
        </form>
      </div>
    </div>
  );
}
