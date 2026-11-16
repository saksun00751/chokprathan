"use client";

import { Delete } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { cn } from "@/lib/cn";

export type OneShotTool = "doors" | "front" | "back" | null;

/** Digit entry: on-screen keypad plus physical keyboard via a focused input. */
export function Keypad({
  digits,
  entry,
  tool,
  disabled,
  onDigit,
  onBackspace,
  onClear,
  onEnter,
}: {
  digits: number;
  entry: string;
  tool: OneShotTool;
  disabled: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onEnter: () => void;
}) {
  const k = useI18n().t.play.keypad;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, [digits]);

  const slots = tool ? 1 : digits;
  const shown = tool ? "" : entry;

  return (
    <div>
      <label className="block">
        <span className="sr-only">{fmt(k.type, { n: digits })}</span>
        <input
          ref={inputRef}
          value={shown}
          inputMode="none"
          autoComplete="off"
          disabled={disabled}
          onChange={() => {}}
          onKeyDown={(e) => {
            if (/^\d$/.test(e.key)) {
              e.preventDefault();
              onDigit(e.key);
            } else if (e.key === "Backspace") {
              e.preventDefault();
              onBackspace();
            } else if (e.key === "Escape") {
              onClear();
            } else if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          className="peer sr-only"
        />
        <span
          className={cn(
            "flex h-14 cursor-text items-center sm:h-16 justify-center gap-2 rounded-card border bg-surface transition-colors",
            "border-line-strong peer-focus-visible:border-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/25",
          )}
        >
          {Array.from({ length: slots }, (_, i) => (
            <span
              key={i}
              className={cn(
                "tnum grid h-11 w-10 place-items-center rounded-[8px] text-2xl font-semibold",
                shown[i] ? "bg-brand-soft text-brand-soft-ink" : "bg-panel text-ink-3",
                i === shown.length && "ring-2 ring-brand/40",
              )}
            >
              {shown[i] ?? ""}
            </span>
          ))}
          {tool && <span className="text-sm font-medium text-brand">{k.oneDigit}</span>}
        </span>
      </label>

      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={k.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => onDigit(d)} disabled={disabled}>
            {d}
          </Key>
        ))}
        <Key onClick={onClear} disabled={disabled} subtle aria-label={k.clearLabel}>
          <span className="text-base font-medium">{k.clear}</span>
        </Key>
        <Key onClick={() => onDigit("0")} disabled={disabled}>
          0
        </Key>
        <Key onClick={onBackspace} disabled={disabled} subtle aria-label={k.backspace}>
          <Delete className="size-6" aria-hidden="true" />
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  disabled,
  subtle,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  subtle?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className={cn(
        "tnum grid h-12 place-items-center rounded-control text-2xl sm:h-14 font-semibold transition-[background-color,transform] duration-100 select-none active:scale-[0.97]",
        subtle ? "bg-panel text-ink-2 hover:bg-line" : "border border-line bg-surface text-ink shadow-card hover:bg-panel",
        "disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
