import { Suspense } from "react";
import { RoundCardSkeleton } from "@/components/lotto/round-card";
import { PageHeader } from "@/components/ui/primitives";
import type { LottoGroup } from "@/domain/types";
import { getI18n, pageMeta } from "@/i18n/rsc";
import { getLobby } from "@/server/data/lobby";
import { LobbyView } from "./lobby-view";

export const generateMetadata = () => pageMeta("lotto");

const GROUPS: LottoGroup[] = ["thai", "foreign", "stock", "yiki"];

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
  const [{ group }, data] = await Promise.all([searchParams, getLobby()]);
  const initial = GROUPS.find((g) => g === group) ?? "all";
  return <LobbyView data={data} initialGroup={initial} />;
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
