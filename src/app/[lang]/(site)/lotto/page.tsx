import { Suspense } from "react";
import { RoundCardSkeleton } from "@/components/lotto/round-card";
import { PageHeader } from "@/components/ui/primitives";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getGroups } from "@/server/data/groups";
import { getLobby } from "@/server/data/lobby";
import { LobbyView } from "./lobby-view";

export const generateMetadata = () => pageMeta("lotto");

export default async function LottoLobbyPage({ searchParams }: PageProps<"/[lang]/lotto">) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.site.lobby.title} description={t.site.lobby.description} />
      <Suspense fallback={<LobbySkeleton />}>
        <LobbyBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LobbyBody({ searchParams }: Pick<PageProps<"/[lang]/lotto">, "searchParams">) {
  const [{ group }, data, groups] = await Promise.all([searchParams, getLobby(), getGroups()]);
  const initial = groups.find((g) => g.code === group)?.code ?? "all";
  return <LobbyView data={data} groups={groups} initialGroup={initial} />;
}

function LobbySkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton mb-5 h-11 w-full max-w-md" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <RoundCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
