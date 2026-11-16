"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { Guilloche } from "@/components/brand/guilloche";
import { Button, ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/client";

type Game = { id: number; category: "casino" | "slot" | "sport"; provider: string; name: string; tag: string | null; hue: number };

export function GameGrid({ games }: { games: Game[] }) {
  const { t } = useI18n();
  const CATEGORY = t.site.games.categories;
  const [open, setOpen] = useState<Game | null>(null);
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {games.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => setOpen(g)}
              className="group relative flex aspect-[4/3] w-full flex-col justify-end overflow-hidden rounded-card p-3 text-left text-white shadow-card"
              style={{ background: `oklch(0.34 0.11 ${g.hue})` }}
            >
              <Guilloche variant="waves" className="absolute inset-0 size-full text-white" strokeOpacity={0.22} />
              {g.tag && <span className="absolute top-2.5 left-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink">{g.tag}</span>}
              <span className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-white/15 transition-colors group-hover:bg-white/30" aria-hidden="true">
                <Play className="size-4" />
              </span>
              <span className="relative text-base font-semibold">{g.name}</span>
              <span className="relative text-xs text-white/80">
                {CATEGORY[g.category]} · {g.provider}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        description={open ? `${CATEGORY[open.category]} · ${open.provider}` : undefined}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setOpen(null)}>
              {t.common.close}
            </Button>
            <ButtonLink href="/lotto" size="lg">
              {t.site.games.goLotto}
            </ButtonLink>
          </div>
        }
      >
        <p className="text-ink-2">{t.site.games.soonBody}</p>
      </Sheet>
    </>
  );
}
