"use client";

import { useState } from "react";
import type { SlipLine } from "chokprathan-core/rules/quote";
import type { BetTypeCode } from "chokprathan-core/rules/types";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { planPaste } from "@/domain/bet-packages";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";

/** Paste a slip as text. Readable lines are added on confirm; the others stay here to be fixed. */
export function PasteSheet({
  open,
  onClose,
  offered,
  taken,
  closed,
  room,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  offered: ReadonlyMap<BetTypeCode, unknown>;
  taken: ReadonlySet<string>;
  closed: ReadonlySet<string>;
  room: number;
  onAdd: (lines: SlipLine[]) => void;
}) {
  const ps = useI18n().t.play.paste;
  const [text, setText] = useState("");
  const { add, rejected } = planPaste(text, { offered, taken, closed, room });

  const confirm = () => {
    onAdd(add);
    setText(rejected.map((r) => r.text).join("\n"));
    if (rejected.length === 0) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ps.title}
      description={ps.hint}
      footer={
        <Button size="lg" className="w-full" disabled={add.length === 0} onClick={confirm}>
          {fmt(ps.add, { n: add.length })}
        </Button>
      }
    >
      <label htmlFor="paste-slip" className="sr-only">
        {ps.label}
      </label>
      <textarea
        id="paste-slip"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 20_000))}
        rows={6}
        placeholder={"12 34 56 = 50x20\n123 = 10"}
        className="tnum w-full rounded-control border border-line-strong bg-surface p-3 text-base placeholder:text-ink-3"
      />
      {rejected.length > 0 && (
        <div role="status" className="mt-3">
          <p className="text-sm font-semibold text-danger">{ps.rejected}</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-sm">
            {rejected.map((r) => (
              <li key={r.line} className="rounded-[8px] bg-danger-soft px-3 py-2 text-danger">
                <span className="font-semibold">{fmt(ps.line, { n: r.line })}</span> <span className="tnum break-all">{r.text}</span>
                <span className="block text-xs">{ps.reasons[r.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
