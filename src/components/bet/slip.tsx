"use client";

import { Trash2, X } from "lucide-react";
import { BET_TYPE_ORDER } from "@/domain/betTypes";
import { formatBaht, formatRate } from "@/domain/money";
import { RateChip } from "@/components/ui/rate-chip";
import { useI18n } from "@/i18n/client";
import { fmt, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/cn";
import { liveRate, type BadgeMap, type ConfigMap, type SlipItem } from "./types";

export function SlipList({
  items,
  configs,
  badges,
  onStake,
  onRemove,
  disabled,
}: {
  items: SlipItem[];
  configs: ConfigMap;
  badges: BadgeMap;
  onStake: (key: string, stake: number) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}) {
  const sl = useI18n().t.play.slip;
  const groups = BET_TYPE_ORDER.flatMap((code) => {
    const cfg = configs.get(code);
    const list = items.filter((i) => i.betType === code);
    return cfg && list.length ? [{ cfg, list }] : [];
  });

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ cfg, list }) => (
        <section key={cfg.code} aria-label={cfg.label}>
          <header className="flex items-baseline justify-between gap-2 pb-1.5">
            <h3 className="text-sm font-semibold text-ink">{cfg.label}</h3>
            <p className="text-xs text-ink-3">
              {sl.pays} <span className="tnum">×{formatRate(cfg.rate100)}</span> · <span className="tnum">{fmt(sl.count, { n: list.length })}</span>
            </p>
          </header>
          <ul className="divide-y divide-line rounded-control border border-line bg-surface">
            {list.map((item) => {
              const rate = liveRate(badges, cfg, item.number);
              const invalid = item.stake < cfg.minStake || item.stake > cfg.maxPerNumber;
              return (
                <li key={item.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)_5.5rem_2.25rem] items-center gap-2 py-2 pr-1 pl-3">
                  <span className="tnum text-lg font-semibold tracking-[0.06em] text-ink">{item.number}</span>
                  <span className="min-w-0">
                    <RateChip baseRate100={cfg.rate100} rate100={rate === cfg.rate100 ? undefined : rate} compact />
                    {rate !== null && item.stake > 0 && (
                      <span className="tnum block truncate text-xs text-ink-3">{fmt(sl.ifWin, { amount: formatBaht(item.stake * rate, { decimals: "auto" }) })}</span>
                    )}
                  </span>
                  <label className="relative">
                    <span className="sr-only">{fmt(sl.stakeFor, { number: item.number })}</span>
                    <input
                      value={item.stake === 0 ? "" : String(item.stake)}
                      inputMode="numeric"
                      disabled={disabled}
                      onChange={(e) => onStake(item.key, Number(e.target.value.replace(/\D/g, "").slice(0, 7)) || 0)}
                      aria-invalid={invalid || undefined}
                      className={cn(
                        "tnum h-10 w-full rounded-[8px] border bg-surface pr-6 pl-2 text-right text-base font-semibold",
                        invalid ? "border-danger text-danger" : "border-line-strong",
                      )}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-3">฿</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onRemove(item.key)}
                    disabled={disabled}
                    className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-danger-soft hover:text-danger"
                    aria-label={fmt(sl.remove, { number: item.number })}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function SlipTotals({ count, total, balance }: { count: number; total: number; balance: number }) {
  const sl = useI18n().t.play.slip;
  const after = balance - total * 100;
  return (
    <dl className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-ink-2">
          {fmt(sl.total, { n: count })}
        </dt>
        <dd className="tnum text-base font-semibold text-ink">฿{formatNumber(total)}</dd>
      </div>
      <div className="flex justify-between text-ink-3">
        <dt>{sl.after}</dt>
        <dd className={cn("tnum", after < 0 && "font-semibold text-danger")}>฿{formatBaht(after)}</dd>
      </div>
    </dl>
  );
}

export function BulkStake({ onApply, onClear, disabled }: { onApply: (stake: number) => void; onClear: () => void; disabled?: boolean }) {
  const sl = useI18n().t.play.slip;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(new FormData(e.currentTarget).get("bulk"));
        if (v > 0) onApply(Math.floor(v));
      }}
    >
      <label className="relative flex-1">
        <span className="sr-only">{sl.bulkLabel}</span>
        <input name="bulk" inputMode="numeric" placeholder={sl.bulkPlaceholder} disabled={disabled} className="tnum h-10 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-sm placeholder:text-ink-3" />
      </label>
      <button type="submit" disabled={disabled} className="h-10 rounded-[8px] bg-panel px-3 text-sm font-semibold text-ink hover:bg-line">
        {sl.bulkApply}
      </button>
      <button type="button" onClick={onClear} disabled={disabled} className="grid size-10 place-items-center rounded-[8px] text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={sl.clearAll}>
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}
