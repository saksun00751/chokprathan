import { ListChecks } from "lucide-react";
import { Suspense } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { fmt } from "@/i18n/format";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { deleteNumberSetAction } from "@/server/actions/bills";
import { getNumberSets } from "@/server/data/member";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => pageMeta("numbersets");

export default async function NumberSetsPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.meta.numbersets.title} description={t.play.sets.description} />
      <Suspense fallback={<Skeleton className="h-64 rounded-card" />}>
        <SetsBody />
      </Suspense>
    </>
  );
}

async function SetsBody() {
  const viewer = await requireViewer("/numbersets");
  const [sets, { t }] = await Promise.all([getNumberSets(viewer.id), getI18n()]);
  const st = t.play.sets;
  if (sets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title={st.emptyTitle}
          description={st.emptyBody}
          action={<ButtonLink href="/lotto">{st.goBet}</ButtonLink>}
        />
      </Card>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sets.map((s) => (
        <li key={s.id}>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{s.name}</h2>
                <p className="text-sm text-ink-3">{fmt(st.count, { n: s.items.length })}</p>
              </div>
              <ActionButton action={deleteNumberSetAction.bind(null, s.id)} variant="dangerGhost" size="sm">
                {t.common.delete}
              </ActionButton>
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {s.items.map((i, idx) => (
                <li key={idx} className="tnum rounded-full bg-panel px-2.5 py-1 text-xs">
                  <span className="text-ink-3">{t.lotto.betTypes[i.betType]?.short}</span> <b className="font-semibold">{i.number}</b> · ฿{i.stake}
                </li>
              ))}
            </ul>
          </Card>
        </li>
      ))}
    </ul>
  );
}
