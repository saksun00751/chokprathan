import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, LogOut } from "lucide-react";
import { io } from "next/cache";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { ActiveAdminNav, AdminNav, type NavState } from "@/components/admin/nav";
import { ConfirmProvider } from "@/components/admin/confirm";
import { NAV_GROUPS } from "@/components/admin/nav-items";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { SessionWatch } from "@/components/shell/session-watch";
import { Skeleton } from "@/components/ui/primitives";
import { fmt } from "@/i18n/format";
import { Provide } from "@/i18n/provide";
import { getI18n } from "@/i18n/rsc";
import { q1 } from "@/server/db";
import { staffLogoutAction } from "@/server/actions/auth";
import { can } from "@/server/services/auth";
import { requireStaffAllowingPasswordChange } from "@/server/data/admin";
import { getStaff, needsTotpSetup } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t.admin.shell.title, template: fmt(t.admin.shell.titleTemplate, { brand: t.common.brand }) },
    robots: { index: false, follow: false },
  };
}

async function navState(): Promise<NavState | null> {
  const viewer = await getStaff();
  if (viewer?.role !== "staff") return null;
  await io();
  // Until the password is changed (or 2-step sign-in set up, when required) only the security page opens.
  if (viewer.mustChangePassword || (await needsTotpSetup(viewer))) return { allowed: ["/admin/security"], badges: { finance: 0, results: 0 } };
  const allowed = NAV_GROUPS.flatMap((g) => g.items)
    .filter((i) => i.need === null || can(viewer, i.need))
    .map((i) => i.href);
  const wantFinance = can(viewer, "finance.view");
  const wantResults = can(viewer, "rounds.result");
  const counts =
    wantFinance || wantResults
      ? await q1<{ f: number; r: number }>(
          `SELECT
             ${wantFinance ? "(SELECT COUNT(*) FROM deposits WHERE status = 'pending') + (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending')" : "0"} AS f,
             ${wantResults ? "(SELECT COUNT(*) FROM rounds r JOIN lottos l ON l.id = r.lotto_id WHERE r.status = 'scheduled' AND r.closes_at <= ? AND l.auto_result = 0)" : "0"} AS r`,
          ...(wantResults ? [Date.now()] : []),
        )
      : undefined;
  return { allowed, badges: { finance: counts?.f ?? 0, results: counts?.r ?? 0 } };
}

async function LiveNav({ variant }: { variant: "side" | "top" }) {
  const state = await navState();
  if (!state) return <AdminNav pathname={null} state={null} variant={variant} />;
  return <ActiveAdminNav state={state} variant={variant} />;
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireStaffAllowingPasswordChange();
  return children;
}

async function AdminName() {
  const [viewer, { t }] = await Promise.all([getStaff(), getI18n()]);
  if (viewer?.role !== "staff") return null;
  return (
    <span className="flex min-w-0 flex-col text-right leading-tight">
      <span className="max-w-40 truncate text-sm font-medium text-ink">{viewer.name || viewer.username}</span>
      <span className="max-w-40 truncate text-xs text-ink-3">{viewer.staffRoleName ?? t.admin.shell.staff}</span>
    </span>
  );
}

export default async function AdminLayout({ children }: LayoutProps<"/[lang]/admin">) {
  const { t } = await getI18n();
  const sh = t.admin.shell;
  return (
    <Provide ns={["admin"]}>
      <ConfirmProvider>
        <SessionWatch door="staff" />
        <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
          <aside className="sticky top-0 hidden h-dvh flex-col bg-ink text-white lg:flex">
            <Link href="/admin" className="flex h-16 shrink-0 items-center gap-2.5 px-5">
              <LogoMark className="size-7" />
              <span className="font-semibold whitespace-nowrap">{sh.title}</span>
            </Link>
            <Suspense fallback={<AdminNav pathname={null} state={null} variant="side" />}>
              <LiveNav variant="side" />
            </Suspense>
            <p className="px-5 py-4 text-xs text-on-deep-2">{t.common.brand}</p>
          </aside>
          <div className="flex min-w-0 flex-col">
            <header className="sticky top-0 z-30 border-b border-line bg-surface">
              <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
                <Link href="/admin" className="flex items-center gap-2 lg:hidden">
                  <LogoMark className="size-7" />
                  <span className="font-semibold">{sh.title}</span>
                </Link>
                <div className="flex-1" />
                <LanguageSwitcher />
                <Link
                  href="/"
                  className="inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-ink-2 hover:bg-panel hover:text-ink"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{sh.viewSite}</span>
                </Link>
                <div className="hidden sm:block">
                  <Suspense fallback={null}>
                    <AdminName />
                  </Suspense>
                </div>
                <form action={staffLogoutAction}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-danger hover:bg-danger-soft"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{sh.logout}</span>
                  </button>
                </form>
              </div>
              <div className="lg:hidden">
                <Suspense fallback={<AdminNav pathname={null} state={null} variant="top" />}>
                  <LiveNav variant="top" />
                </Suspense>
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
              <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
                <AdminGate>{children}</AdminGate>
              </Suspense>
            </main>
          </div>
        </div>
      </ConfirmProvider>
    </Provide>
  );
}
