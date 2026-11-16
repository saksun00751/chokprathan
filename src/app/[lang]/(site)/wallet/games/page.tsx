import { Suspense } from "react";
import { Badge, Card, Money, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatDateTime } from "@/i18n/format";
import { getI18n, titled } from "@/i18n/rsc";
import { gameHistory } from "@/server/data/games";
import { requireViewer } from "@/server/session";

export const generateMetadata = () => titled((t) => t.money.games.title);

export default async function GameHistoryPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.money.games.title} description={t.money.games.description} back={{ href: "/wallet", label: t.meta.wallet.title }} />
      <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
        <HistoryBody />
      </Suspense>
    </>
  );
}

async function HistoryBody() {
  const viewer = await requireViewer("/wallet/games");
  const { lang, t } = await getI18n();
  const rows = await gameHistory(viewer.id, lang, 200);
  const m = t.money.games;
  if (rows.length === 0) return <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-ink-3">{m.empty}</p>;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const note = m.status[r.status as keyof typeof m.status];
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.game}</span>
                <span className="block text-xs text-ink-3">
                  {r.product} · {formatDateTime(r.at, lang)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-sm">
                {note ? (
                  <Badge tone={r.status === "OPEN" || r.status === "WAITING" ? "brand" : "outline"}>{note}</Badge>
                ) : (
                  <Money
                    satang={r.net}
                    sign
                    decimals="auto"
                    className={r.net > 0 ? "font-semibold text-success" : r.net < 0 ? "font-semibold" : "text-ink-3"}
                  />
                )}
                <span className="tnum text-xs text-ink-3">
                  {m.stake} <Money satang={r.bet} decimals="auto" /> · {m.payout} <Money satang={r.payout} decimals="auto" />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
