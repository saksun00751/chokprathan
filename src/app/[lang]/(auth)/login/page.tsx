import { Suspense } from "react";
import { SessionEndedNotice } from "@/components/shell/session-ended";
import { Skeleton } from "@/components/ui/primitives";
import { endedParam } from "@/domain/sessions";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getSiteInfo } from "@/server/data/site";
import { LoginForm } from "./login-form";

export const generateMetadata = () => pageMeta("login");

export default async function LoginPage({ searchParams }: PageProps<"/[lang]/login">) {
  const { t } = await getI18n();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.login.title}</h1>
      <p className="mt-1 text-ink-2">{t.auth.login.subtitle}</p>
      <Suspense fallback={<FormSkeleton />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginBody({ searchParams }: Pick<PageProps<"/[lang]/login">, "searchParams">) {
  const [{ next, ended }, site, { t }] = await Promise.all([searchParams, getSiteInfo(), getI18n()]);
  const reason = endedParam(ended);
  return (
    <>
      {reason && <SessionEndedNotice reason={reason} s={t.common.session} />}
      <LoginForm next={typeof next === "string" ? next : "/"} demoMode={site.demoMode} />
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
