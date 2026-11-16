"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { useConfirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { setGameProductAction, syncGamesAction } from "@/server/actions/admin";

/** Pull products and games from the aggregator now (it also refreshes on its own every day). */
export function SyncGamesButton({ disabled }: { disabled?: boolean }) {
  const ga = useI18n().t.admin.content.games;
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      disabled={disabled}
      onClick={() =>
        start(async () => {
          const r = await syncGamesAction();
          if (r.ok) toast.success(r.message ?? ga.sync);
          else toast.error(r.error);
        })
      }
    >
      <RefreshCw className="size-4" aria-hidden="true" />
      {ga.sync}
    </Button>
  );
}

/** Offer a provider in the members' lobby, or take it off (games in progress still settle). */
export function GameProductToggle({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const { t } = useI18n();
  const ga = t.admin.content.games;
  const k = t.admin.shell.confirm;
  const ask = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={enabled ? "dangerGhost" : "secondary"}
      loading={pending}
      onClick={async () => {
        const answer = await ask(
          enabled
            ? { title: k.gameOff, tone: "danger", details: [[ga.productCol, name]], note: k.gameOffNote, confirmLabel: ga.turnOff }
            : { title: k.gameOn, details: [[ga.productCol, name]], confirmLabel: ga.turnOn },
        );
        if (!answer.ok) return;
        start(async () => {
          const r = await setGameProductAction(id, !enabled);
          if (r.ok) toast.success(r.message ?? ga.sync);
          else toast.error(r.error);
        });
      }}
    >
      {enabled ? ga.turnOff : ga.turnOn}
    </Button>
  );
}
