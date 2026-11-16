import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SessionEndedNotice } from "@/components/shell/session-ended";
import { Skeleton } from "@/components/ui/primitives";
import { endedParam } from "@/domain/sessions";
import { staffNext } from "@/domain/doors";
import { getI18n } from "@/i18n/rsc";
import { getStaff } from "@/server/session";
import { ConsoleForm } from "./console-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.console.title, robots: { index: false, follow: false } };
}

export default async function ConsolePage({ searchParams }: PageProps<"/[lang]/console">) {
  const { t } = await getI18n();
  return (
    <>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{t.console.title}</h1>
      <p className="mt-1 text-sm text-ink-2">{t.console.description}</p>
      <Suspense fallback={<FormSkeleton />}>
        <ConsoleBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ConsoleBody({ searchParams }: Pick<PageProps<"/[lang]/console">, "searchParams">) {
  const [{ next, ended }, staff, { t }] = await Promise.all([searchParams, getStaff(), getI18n()]);
  const target = staffNext(Array.isArray(next) ? next[0] : next);
  // Already signed in to the console: straight to the back office.
  if (staff) redirect(target);
  const reason = endedParam(ended);
  return (
    <>
      {reason && <SessionEndedNotice reason={reason} s={t.common.session} />}
      <ConsoleForm next={target} />
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
    </div>
  );
}
