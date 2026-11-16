"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

export type CellState = "idle" | "selected" | "cut" | "selected-cut" | "closed";

/** Tap-to-toggle number panel. 1 digit: 0–9. 2 digits: 00–99. 3 digits: hundreds tabs + 00–99. */
export function PanelGrid({
  digits,
  stateOf,
  onToggle,
  disabled,
}: {
  digits: number;
  stateOf: (n: string) => CellState;
  onToggle: (n: string) => void;
  disabled: boolean;
}) {
  const p = useI18n().t.play.panel;
  const [hundred, setHundred] = useState("0");

  if (digits >= 4) {
    return <p className="rounded-card bg-panel p-4 text-sm text-ink-2">{p.keypadOnly}</p>;
  }

  const numbers =
    digits === 1
      ? Array.from({ length: 10 }, (_, i) => String(i))
      : Array.from({ length: 100 }, (_, i) => `${digits === 3 ? hundred : ""}${String(i).padStart(2, "0")}`);

  return (
    <div>
      {digits === 3 && (
        <div className="mb-3" role="tablist" aria-label={p.hundreds}>
          <p className="mb-1.5 text-xs text-ink-3">{p.hundreds}</p>
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, i) => String(i)).map((h) => (
              <button
                key={h}
                type="button"
                role="tab"
                aria-selected={hundred === h}
                onClick={() => setHundred(h)}
                className={cn(
                  "tnum h-9 rounded-[8px] text-sm font-semibold transition-colors",
                  hundred === h ? "bg-brand text-white" : "bg-panel text-ink-2 hover:bg-line",
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={cn("grid gap-1", digits === 1 ? "grid-cols-5" : "grid-cols-10")} role="group" aria-label={p.grid}>
        {numbers.map((n) => {
          const s = stateOf(n);
          const selected = s === "selected" || s === "selected-cut";
          return (
            <button
              key={n}
              type="button"
              disabled={disabled || s === "closed"}
              aria-pressed={selected}
              aria-label={`${n}${s === "closed" ? ` ${p.closed}` : s.includes("cut") ? ` ${p.cut}` : ""}`}
              onClick={() => onToggle(n)}
              className={cn(
                "tnum relative grid place-items-center rounded-[8px] font-semibold transition-colors",
                digits === 1 ? "h-12 text-lg" : "h-9 text-[13px] sm:h-10 sm:text-sm",
                selected
                  ? "bg-brand text-white"
                  : s === "closed"
                    ? "bg-danger-soft text-danger/60 line-through"
                    : "border border-line bg-surface text-ink hover:border-brand/50",
              )}
            >
              {digits === 3 ? n.slice(1) : n}
              {(s === "cut" || s === "selected-cut") && (
                <span className={cn("absolute top-0.5 right-0.5 size-1.5 rounded-full", selected ? "bg-gold" : "bg-warning")} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" /> {p.cut}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-danger/70 line-through">00</span> {p.closed}
        </span>
      </p>
    </div>
  );
}
