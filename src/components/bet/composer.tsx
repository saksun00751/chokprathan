"use client";

import Link from "next/link";
import { BookmarkPlus, Check, ChevronUp, Info, Keyboard, Grid3x3, ListChecks, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { BET_TYPE_ORDER } from "chokprathan-core/rules/betTypes";
import { formatRate } from "chokprathan-core/rules/money";
import { doubles, nineteenDoors, permutations, swipeBack, swipeFront, triples } from "chokprathan-core/rules/numbers";
import type { BetTypeCode } from "chokprathan-core/rules/types";
import { useI18n } from "@/i18n/client";
import { fmt, formatClock, formatDate, formatNumber } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Countdown, ServerTimeSync, useNow } from "@/components/ui/clock";
import { Flag } from "@/components/ui/flag";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { saveNumberSetAction } from "@/server/actions/bills";
import type { BetConfigView, BetPageData } from "@/server/data/bet";
import type { LimitBadge } from "@/server/services/risk";
import { Keypad, type OneShotTool } from "./keypad";
import { PanelGrid, type CellState } from "./panel-grid";
import { ReviewSheet } from "./review-sheet";
import { BulkStake, SlipList, SlipTotals } from "./slip";
import { itemKey, type SlipItem } from "./types";

type Mode = "keypad" | "panel" | "sets";
const QUICK_STAKES = [5, 10, 20, 50, 100];

function defaultSelection(configs: BetConfigView[]): BetTypeCode[] {
  const has = (c: BetTypeCode) => configs.some((x) => x.code === c);
  if (has("top2") && has("bottom2")) return ["top2", "bottom2"];
  return configs[0] ? [configs[0].code] : [];
}

export function BetComposer({ data }: { data: BetPageData }) {
  const { lang, t } = useI18n();
  const c_ = t.play.composer;
  const toast = useToast();
  const now = useNow(data.serverNow);
  const configs = useMemo(() => new Map(data.configs.map((c) => [c.code, c])), [data.configs]);

  // Live cut rates: whichever is newer wins, the server render (after refresh) or the last poll.
  const [polled, setPolled] = useState<{ at: number; list: LimitBadge[] } | null>(null);
  const badgeList = polled && polled.at > data.serverNow ? polled.list : data.badges;
  const badges = useMemo(() => new Map(badgeList.map((b) => [itemKey(b.betType, b.number), b])), [badgeList]);

  const [selected, setSelected] = useState<BetTypeCode[]>(() => defaultSelection(data.configs));
  const digits = configs.get(selected[0])?.digits ?? 2;
  const [mode, setMode] = useState<Mode>("keypad");
  const [entry, setEntry] = useState("");
  const [tool, setTool] = useState<OneShotTool>(null);
  const [reverse, setReverse] = useState(false);
  const [stakeDefault, setStakeDefault] = useState(10);
  const [items, setItems] = useState<SlipItem[]>(() =>
    data.initialLines
      .filter((l) => configs.has(l.betType))
      .map((l) => ({ key: itemKey(l.betType, l.number), betType: l.betType, number: l.number, stake: l.stake })),
  );
  const [feedback, setFeedback] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [undo, setUndo] = useState<SlipItem[] | null>(null);

  const closed = data.round.phase !== "open" || now >= data.round.closesAt;
  const total = items.reduce((s, i) => s + i.stake, 0);

  /* live cut rates */
  useEffect(() => {
    if (closed) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/rounds/${data.round.id}/limits`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { serverNow: number; badges: LimitBadge[] };
          setPolled({ at: body.serverNow, list: body.badges });
        }
      } catch {
        /* keep the last known rates; the server re-checks on confirm */
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [closed, data.round.id]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  /* ---------- slip mutations ---------- */

  function addNumbers(numbers: string[], types: BetTypeCode[] = selected, stake = stakeDefault) {
    const existing = new Set(items.map((i) => i.key));
    const next = [...items];
    let added = 0;
    let skippedClosed = 0;
    for (const code of types) {
      const cfg = configs.get(code);
      if (!cfg) continue;
      for (const n of numbers) {
        if (n.length !== cfg.digits) continue;
        const key = itemKey(code, n);
        if (existing.has(key)) continue;
        if (badges.get(key)?.rate100 === null) {
          skippedClosed++;
          continue;
        }
        existing.add(key);
        next.push({ key, betType: code, number: n, stake: Math.min(Math.max(stake, cfg.minStake), cfg.maxPerNumber) });
        added++;
      }
    }
    setItems(next);
    setUndo(null);
    setFeedback(
      added === 0 && skippedClosed === 0 ? c_.alreadyIn : skippedClosed ? fmt(c_.addedSkipped, { n: added, skipped: skippedClosed }) : fmt(c_.added, { n: added }),
    );
  }

  const removeKeys = (keys: string[]) => setItems((list) => list.filter((i) => !keys.includes(i.key)));
  const setStake = (key: string, stake: number) => setItems((list) => list.map((i) => (i.key === key ? { ...i, stake } : i)));
  const setAllStakes = (stake: number) =>
    setItems((list) =>
      list.map((i) => {
        const cfg = configs.get(i.betType)!;
        return { ...i, stake: Math.min(Math.max(stake, cfg.minStake), cfg.maxPerNumber) };
      }),
    );
  const clearAll = () => {
    if (items.length === 0) return;
    setUndo(items);
    setItems([]);
  };

  /* ---------- entry ---------- */

  function pressDigit(d: string) {
    if (closed) return;
    if (tool) {
      const list = tool === "doors" ? nineteenDoors(d) : tool === "front" ? swipeFront(d) : swipeBack(d);
      addNumbers(list);
      setTool(null);
      return;
    }
    const next = (entry + d).slice(0, digits);
    if (next.length === digits) {
      addNumbers(reverse && digits > 1 ? permutations(next) : [next]);
      setEntry("");
    } else {
      setEntry(next);
    }
  }

  function selectType(code: BetTypeCode) {
    const cfg = configs.get(code)!;
    setEntry("");
    setTool(null);
    setSelected((cur) => {
      const curDigits = configs.get(cur[0])?.digits;
      if (curDigits !== cfg.digits) return [code];
      if (cur.includes(code)) return cur.length > 1 ? cur.filter((c) => c !== code) : cur;
      return BET_TYPE_ORDER.filter((c) => c === code || cur.includes(c));
    });
  }

  function cellState(n: string): CellState {
    let selectedAll = true;
    let cut = false;
    let closedAll = true;
    for (const code of selected) {
      const key = itemKey(code, n);
      if (!items.some((i) => i.key === key)) selectedAll = false;
      const b = badges.get(key);
      if (b?.rate100 !== null) closedAll = false;
      if (b) cut = true;
    }
    if (closedAll && selected.length) return "closed";
    if (selectedAll) return cut ? "selected-cut" : "selected";
    return cut ? "cut" : "idle";
  }

  function toggleCell(n: string) {
    const keys = selected.map((c) => itemKey(c, n));
    if (keys.every((k) => items.some((i) => i.key === k))) removeKeys(keys);
    else addNumbers([n]);
  }

  /* ---------- render ---------- */

  const selectedLabels = selected.map((c) => configs.get(c)?.label).join(" + ");
  const isYiki = data.lotto.group === "yiki";

  const slipPanel = (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="font-semibold">{c_.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{c_.emptyBody}</p>
          {undo && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setItems(undo); setUndo(null); }}>
              {c_.undoClear}
            </Button>
          )}
        </div>
      ) : (
        <>
          <BulkStake onApply={setAllStakes} onClear={clearAll} disabled={closed} />
          <SlipList items={items} configs={configs} badges={badges} onStake={setStake} onRemove={(k) => removeKeys([k])} disabled={closed} />
          <button type="button" onClick={() => setSaveOpen(true)} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand hover:underline">
            <BookmarkPlus className="size-4" aria-hidden="true" />
            {c_.saveAsSet}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="pb-20 lg:pb-0">
      <ServerTimeSync serverNow={data.serverNow} />

      {/* header */}
      <section className="mb-4 rounded-card border border-line bg-surface p-3.5 shadow-card sm:mb-5 sm:p-5">
        <div className="flex items-center gap-3">
          <Flag code={data.lotto.flag} className="size-9 sm:size-10" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-semibold sm:text-xl">{data.lotto.name}</h1>
            <p className="truncate text-sm text-ink-2">
              {data.round.label}
              {!isYiki && <span className="hidden sm:inline"> · {formatDate(data.round.closesAt, lang, "long")}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-3">{fmt(c_.closesAt, { time: formatClock(data.round.closesAt) })}</p>
            <Countdown closesAt={data.round.closesAt} serverNow={data.serverNow} className="text-xl leading-tight sm:text-2xl" />
          </div>
        </div>
        <button type="button" onClick={() => setRatesOpen(true)} className="mt-2 -mb-1 inline-flex h-8 items-center gap-1.5 rounded-control px-1 text-sm font-medium text-brand hover:bg-brand-soft">
          <Info className="size-4" aria-hidden="true" />
          {c_.ratesLink}
        </button>
      </section>

      {isYiki && data.siblings.length > 1 && (
        <nav aria-label={c_.otherRounds} className="-mx-4 mb-5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex w-max gap-2">
            {data.siblings.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/lotto/${s.id}`}
                  aria-current={s.id === data.round.id ? "page" : undefined}
                  className={cn(
                    "flex h-11 flex-col justify-center rounded-control border px-3 text-left",
                    s.id === data.round.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:border-brand/40",
                  )}
                >
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="tnum text-xs">{fmt(c_.closes, { time: formatClock(s.closesAt) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {closed && (
        <div role="status" className="mb-5 flex flex-col gap-3 rounded-card bg-danger-soft p-4 text-danger sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold">{c_.closedNotice}</p>
          <Link href={`/lotto?group=${data.lotto.group}`} className="text-sm font-semibold underline">
            {c_.pickAnother}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* composer */}
        <div className="flex min-w-0 flex-col gap-5">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">{c_.betType}</legend>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {data.configs.map((c) => {
                const on = selected.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => selectType(c.code)}
                    className={cn(
                      "flex h-11 shrink-0 items-center gap-2 rounded-control border px-3 text-sm font-medium whitespace-nowrap transition-colors",
                      on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong bg-surface text-ink hover:border-brand/50",
                    )}
                  >
                    {on && <Check className="size-4" aria-hidden="true" />}
                    {c.label}
                    <span className={cn("tnum text-xs", on ? "text-brand-soft-ink/80" : "text-ink-3")}>×{formatRate(c.rate100)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 hidden text-xs text-ink-3 sm:block">{c_.betTypeHint}</p>
          </fieldset>

          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <span className="shrink-0 text-sm font-semibold">{c_.stake}</span>
            {QUICK_STAKES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={stakeDefault === s}
                onClick={() => setStakeDefault(s)}
                className={cn(
                  "tnum h-9 min-w-11 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors",
                  stakeDefault === s ? "bg-ink text-white" : "bg-panel text-ink-2 hover:bg-line",
                )}
              >
                {s}
              </button>
            ))}
            <label className="relative shrink-0">
              <span className="sr-only">{c_.stakeOther}</span>
              <input
                inputMode="numeric"
                value={QUICK_STAKES.includes(stakeDefault) ? "" : String(stakeDefault)}
                onChange={(e) => setStakeDefault(Number(e.target.value.replace(/\D/g, "").slice(0, 6)) || 10)}
                placeholder={c_.other}
                className="tnum h-9 w-20 rounded-full border border-line-strong bg-surface px-3 text-sm placeholder:text-ink-3"
              />
            </label>
          </div>

          <div>
            <div role="tablist" aria-label={c_.entryMode} className="mb-3 grid grid-cols-3 gap-1 rounded-control bg-panel p-1">
              {(
                [
                  ["keypad", c_.modes.keypad, Keyboard],
                  ["panel", c_.modes.panel, Grid3x3],
                  ["sets", c_.modes.sets, ListChecks],
                ] as const
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex h-10 items-center justify-center gap-1.5 rounded-[8px] text-sm font-medium transition-colors",
                    mode === m ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            <p className="mb-3 hidden text-sm text-ink-2 sm:block">
              {c_.entering} <b className="text-ink">{selectedLabels}</b> {fmt(c_.digits, { n: digits })}
            </p>

            {mode === "keypad" && (
              <div className="flex flex-col gap-3">
                {digits >= 2 && (
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={c_.tools}>
                    <ToolChip on={reverse} onClick={() => setReverse((r) => !r)} icon={<Shuffle className="size-4" aria-hidden="true" />}>
                      {c_.reverse}
                    </ToolChip>
                    {digits === 2 && (
                      <>
                        <ToolChip on={tool === "doors"} onClick={() => setTool((x) => (x === "doors" ? null : "doors"))}>{c_.doors}</ToolChip>
                        <ToolChip on={tool === "front"} onClick={() => setTool((x) => (x === "front" ? null : "front"))}>{c_.front}</ToolChip>
                        <ToolChip on={tool === "back"} onClick={() => setTool((x) => (x === "back" ? null : "back"))}>{c_.back}</ToolChip>
                        <ToolChip onClick={() => addNumbers(doubles())}>{c_.doubles}</ToolChip>
                      </>
                    )}
                    {digits === 3 && <ToolChip onClick={() => addNumbers(triples())}>{c_.triples}</ToolChip>}
                  </div>
                )}
                {tool && (
                  <p className="text-sm text-brand">
                    {tool === "doors" ? c_.doorsHint : tool === "front" ? c_.frontHint : c_.backHint}
                  </p>
                )}
                <Keypad
                  digits={digits}
                  entry={entry}
                  tool={tool}
                  disabled={closed}
                  onDigit={pressDigit}
                  onBackspace={() => setEntry((e) => e.slice(0, -1))}
                  onClear={() => {
                    setEntry("");
                    setTool(null);
                  }}
                  onEnter={() => items.length && setReviewOpen(true)}
                />
              </div>
            )}

            {mode === "panel" && <PanelGrid digits={digits} stateOf={cellState} onToggle={toggleCell} disabled={closed} />}

            {mode === "sets" &&
              (data.sets.length === 0 ? (
                <div className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-ink-2">
                  {c_.noSets}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.sets.map((set) => (
                    <li key={set.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{set.name}</p>
                        <p className="tnum truncate text-sm text-ink-3">{set.items.map((i) => i.number).join(" ")}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={closed}
                        onClick={() => {
                          for (const code of new Set(set.items.map((i) => i.betType))) {
                            const list = set.items.filter((i) => i.betType === code);
                            addNumbers(list.map((i) => i.number), [code], list[0]?.stake ?? stakeDefault);
                          }
                        }}
                      >
                        {c_.useSet}
                      </Button>
                    </li>
                  ))}
                </ul>
              ))}

            <p aria-live="polite" className="mt-3 h-5 text-sm font-medium text-success">
              {feedback}
            </p>
          </div>
        </div>

        {/* desktop slip */}
        <aside aria-label={c_.slip} className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] flex-col rounded-card border border-line bg-surface shadow-card lg:flex">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">{c_.slip}</h2>
            <span className="tnum text-sm text-ink-3">{fmt(c_.slipCount, { n: items.length })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{slipPanel}</div>
          <div className="border-t border-line p-4">
            <SlipTotals count={items.length} total={total} balance={data.balance} />
            <Button size="lg" className="mt-3 w-full" disabled={items.length === 0 || closed} onClick={() => setReviewOpen(true)}>
              {c_.review}
            </Button>
          </div>
        </aside>
      </div>

      {/* mobile slip bar: replaces the bottom nav while betting */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-2.5 pb-2.5 shadow-bar lg:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button type="button" onClick={() => setSlipOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={c_.openSlip}>
            <ChevronUp className="size-5 text-ink-3" aria-hidden="true" />
            <span>
              <span className="block text-xs text-ink-3">
                {fmt(c_.slipTitle, { n: items.length })}
              </span>
              <span className="tnum block text-lg leading-tight font-semibold">฿{formatNumber(total)}</span>
            </span>
          </button>
          <Button size="lg" disabled={items.length === 0 || closed} onClick={() => setReviewOpen(true)}>
            {c_.review}
          </Button>
        </div>
      </div>

      <Sheet
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        title={fmt(c_.slipTitle, { n: items.length })}
        footer={
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SlipTotals count={items.length} total={total} balance={data.balance} />
            </div>
            <Button size="lg" disabled={items.length === 0 || closed} onClick={() => { setSlipOpen(false); setReviewOpen(true); }}>
              {c_.reviewShort}
            </Button>
          </div>
        }
      >
        {slipPanel}
      </Sheet>

      <ReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        roundId={data.round.id}
        title={`${data.lotto.shortName} ${data.round.label}`}
        closesAt={data.round.closesAt}
        serverNow={data.serverNow}
        items={items}
        balance={data.balance}
        onFix={(key, stake) => (stake === null ? removeKeys([key]) : setStake(key, stake))}
        onPlaced={() => {
          setItems([]);
          setUndo(null);
          toast.success(c_.placed);
        }}
      />

      <Sheet open={ratesOpen} onClose={() => setRatesOpen(false)} title={c_.ratesTitle} description={`${data.lotto.name} ${data.round.label}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="pb-2 font-medium">{c_.type}</th>
              <th className="pb-2 text-right font-medium">{c_.perBaht}</th>
              <th className="pb-2 text-right font-medium">{c_.maxPerNumber}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.configs.map((c) => (
              <tr key={c.code}>
                <td className="py-2.5">{c.label}</td>
                <td className="tnum py-2.5 text-right font-semibold">{formatRate(c.rate100)}</td>
                <td className="tnum py-2.5 text-right">฿{formatNumber(c.maxPerNumber)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm text-ink-2">
          {fmt(c_.limits, { min: formatNumber(data.limits.minStake), max: formatNumber(data.limits.maxPerBill), lines: data.limits.maxLines })}
        </p>
        <p className="mt-3 text-sm text-ink-2">
          {c_.cutsNote}{" "}
          <Link href="/rules#rate-cut" className="font-semibold text-brand hover:underline">
            {c_.howCalculated}
          </Link>
        </p>
        {badgeList.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-sm font-semibold">{c_.cutNow}</h3>
            <ul className="flex flex-wrap gap-2">
              {badgeList.map((b) => (
                <li key={`${b.betType}:${b.number}`} className={cn("tnum rounded-full px-2.5 py-1 text-xs font-semibold", b.rate100 === null ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                  {configs.get(b.betType)?.short} {b.number} {b.rate100 === null ? c_.closed : `×${formatRate(b.rate100)}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>

      <SaveSetSheet open={saveOpen} onClose={() => setSaveOpen(false)} items={items} />
    </div>
  );
}

function ToolChip({ on = false, onClick, icon, children }: { on?: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors",
        on ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink hover:border-brand/50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SaveSetSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: SlipItem[] }) {
  const c_ = useI18n().t.play.composer;
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={c_.setSheetTitle}
      description={fmt(c_.setSheetBody, { n: items.length })}
      footer={
        <Button
          size="lg"
          className="w-full"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveNumberSetAction(name, items.map(({ betType, number, stake }) => ({ betType, number, stake })));
              if (!r.ok) return setError(r.error);
              toast.success(c_.setSaved);
              setName("");
              setError(null);
              onClose();
            })
          }
        >
          {c_.saveSet}
        </Button>
      }
    >
      <label htmlFor="set-name" className="text-sm font-medium">
        {c_.setName}
      </label>
      <input
        id="set-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder={c_.setNamePlaceholder}
        className="mt-1.5 h-11 w-full rounded-control border border-line-strong px-3"
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Sheet>
  );
}
