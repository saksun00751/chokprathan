"use client";

import { CircleAlert, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { BET_TYPE_ORDER } from "@/domain/betTypes";
import { formatBaht, formatRate } from "@/domain/money";
import { Button, ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/clock";
import { Sheet } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/client";
import { fmt, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/cn";
import { placeSlipAction, quoteSlipAction } from "@/server/actions/bills";
import type { LineQuote, Quote } from "@/server/services/bills";
import type { SlipItem } from "./types";

type Msg = { tone: "danger" | "warning"; text: string };
type Quoted = { sig: string; quote: Quote | null; message: Msg | null };
type Placed = { billId: number; code: string; total: number };

export function ReviewSheet({
  open,
  onClose,
  roundId,
  title,
  closesAt,
  serverNow,
  items,
  balance,
  onFix,
  onPlaced,
}: {
  open: boolean;
  onClose: () => void;
  roundId: number;
  title: string;
  closesAt: number;
  serverNow: number;
  items: SlipItem[];
  balance: number;
  onFix: (key: string, stake: number | null) => void;
  onPlaced: () => void;
}) {
  const rv = useI18n().t.play.review;
  const [quoted, setQuoted] = useState<Quoted | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [accept, setAccept] = useState(false);
  const [pending, start] = useTransition();

  const lines = [...items]
    .sort((a, b) => BET_TYPE_ORDER.indexOf(a.betType) - BET_TYPE_ORDER.indexOf(b.betType))
    .map(({ betType, number, stake }) => ({ betType, number, stake }));
  const signature = JSON.stringify(lines);
  const loading = open && !placed && quoted?.sig !== signature;
  const quote = quoted?.sig === signature ? quoted.quote : null;
  const message = quoted?.sig === signature ? quoted.message : null;

  // Fetch a fresh quote whenever the sheet opens or the slip changes while it is open.
  useEffect(() => {
    if (!open || placed) return;
    let cancelled = false;
    quoteSlipAction(roundId, JSON.parse(signature)).then((r) => {
      if (cancelled) return;
      setQuoted(
        r.ok
          ? { sig: signature, quote: r.data, message: r.data.error ? { tone: "danger", text: r.data.message ?? rv.cannot } : null }
          : { sig: signature, quote: null, message: { tone: "danger", text: r.error } },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, placed, roundId, signature, rv.cannot]);

  const close = () => {
    if (placed) onPlaced();
    setPlaced(null);
    setQuoted(null);
    onClose();
  };

  const confirm = () =>
    start(async () => {
      if (!quote) return;
      const r = await placeSlipAction(roundId, lines, { expected: quote.fingerprint, acceptChanges: accept });
      if (!r.ok) return setQuoted({ sig: signature, quote, message: { tone: "danger", text: r.error } });
      const result = r.data;
      if (result.ok) {
        setPlaced({ billId: result.billId, code: result.code, total: result.quote.totalStake });
        return;
      }
      setQuoted({
        sig: signature,
        quote: result.quote ?? quote,
        message: { tone: result.error === "rate_changed" ? "warning" : "danger", text: result.message },
      });
    });

  const stage = placed ? ({ kind: "success", ...placed } as const) : loading ? ({ kind: "loading" } as const) : ({ kind: "ready" } as const);
  const total = quote?.totalStake ?? lines.reduce((s, l) => s + l.stake, 0);
  const short = balance < total * 100;
  const rejected = quote?.lines.filter((l) => !l.ok).length ?? 0;
  const reduced = quote?.lines.filter((l) => l.ok && l.reduced).length ?? 0;
  const canConfirm = stage.kind === "ready" && quote?.ok && !quote.error && !short && !pending;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={stage.kind === "success" ? rv.success : rv.title}
      description={
        stage.kind === "success" ? undefined : (
          <span className="flex flex-wrap items-center gap-x-2">
            {title} · {rv.closesIn} <Countdown closesAt={closesAt} serverNow={serverNow} />
          </span>
        )
      }
      size="lg"
      footer={
        stage.kind === "success" ? (
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink href={`/bills/${stage.billId}`} variant="secondary" size="lg" onClick={() => onPlaced()}>
              {rv.viewBill}
            </ButtonLink>
            <Button size="lg" onClick={close}>
              {rv.continue}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {reduced > 0 && (
              <label className="flex items-start gap-2.5 text-sm text-ink-2">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                {rv.acceptChanges}
              </label>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-3">{rv.total}</p>
                <p className="tnum text-xl font-semibold">฿{formatNumber(total)}</p>
              </div>
              {short ? (
                <ButtonLink href="/wallet/deposit" size="lg" variant="gold">
                  {rv.depositMore}
                </ButtonLink>
              ) : (
                <Button size="lg" onClick={confirm} disabled={!canConfirm} loading={pending} className="min-w-40">
                  {rv.confirm}
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      {stage.kind === "success" ? (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="grid size-16 animate-pop place-items-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-9" aria-hidden="true" />
          </span>
          <p className="mt-4 text-lg font-semibold">{rv.sent}</p>
          <p className="mt-1 text-ink-2">
            {rv.billNo} <span className="tnum font-semibold text-ink">{stage.code}</span>
          </p>
          <p className="tnum mt-3 text-2xl font-semibold">฿{formatNumber(stage.total)}</p>
          <p className="mt-1 text-sm text-ink-3">{rv.paidOnResult}</p>
        </div>
      ) : stage.kind === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink-2">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {rv.quoting}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {message && (
            <p role="alert" className={cn("flex items-start gap-2 rounded-control px-3 py-2.5 text-sm", message.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {message.text}
            </p>
          )}
          {short && (
            <p className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {fmt(rv.short, { amount: formatBaht(total * 100 - balance) })}
            </p>
          )}
          {reduced > 0 && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {fmt(rv.reduced, { n: reduced })}
            </p>
          )}
          {rejected > 0 && (
            <p className="text-sm text-danger">{fmt(rv.rejected, { n: rejected })}</p>
          )}
          <ul className="divide-y divide-line rounded-control border border-line">
            {(quote?.lines ?? []).map((line, i) => (
              <QuoteRow key={`${line.betType}:${line.number}:${i}`} line={line} onFix={(stake) => onFix(`${line.betType}:${line.number}`, stake)} />
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function QuoteRow({ line, onFix }: { line: LineQuote; onFix: (stake: number | null) => void }) {
  const { t } = useI18n();
  const rv = t.play.review;
  const label = t.lotto.betTypes[line.betType].label;
  if (!line.ok) {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-danger-soft/50 px-3 py-2.5">
        <span className="tnum w-12 text-lg font-semibold">{line.number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{label} · ฿{formatNumber(line.stake)}</span>
          <span className="block text-sm font-medium text-danger">{line.message}</span>
        </span>
        <span className="flex gap-1.5">
          {line.reason === "cap" && (line.remaining ?? 0) > 0 && (
            <Button size="sm" variant="secondary" onClick={() => onFix(line.remaining!)}>
              {fmt(rv.reduceTo, { amount: formatNumber(line.remaining!) })}
            </Button>
          )}
          <Button size="sm" variant="dangerGhost" onClick={() => onFix(null)}>
            {rv.remove}
          </Button>
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="tnum w-12 text-lg font-semibold">{line.number}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">
          {label} · <span className="tnum">฿{formatNumber(line.stake)}</span>
        </span>
        <span className="block text-xs text-ink-3">
          {line.segments.length > 1
            ? line.segments.map((s) => `฿${formatNumber(s.stake)} × ${formatRate(s.rate100)}`).join(" + ")
            : fmt(rv.pays, { rate: formatRate(line.rate100) })}
          {line.reduced && line.segments.length === 1 && <s className="ml-1.5">×{formatRate(line.baseRate100)}</s>}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-xs text-ink-3">{rv.ifWin}</span>
        <span className={cn("tnum block text-sm font-semibold", line.reduced ? "text-warning" : "text-ink")}>
          ฿{formatBaht(line.potential, { decimals: "auto" })}
        </span>
      </span>
    </li>
  );
}
