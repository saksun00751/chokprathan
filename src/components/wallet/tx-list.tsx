"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgePercent,
  Gift,
  HandCoins,
  RotateCcw,
  SlidersHorizontal,
  Ticket,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, Money } from "@/components/ui/primitives";
import { formatBaht } from "chokprathan-core/rules/money";
import { useI18n } from "@/i18n/client";
import { fmt, formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { TxRow } from "@/server/data/wallet";

const ICON: Record<string, LucideIcon> = {
  deposit: ArrowDownToLine,
  withdraw: ArrowUpFromLine,
  withdraw_refund: RotateCcw,
  debt_repay: HandCoins,
  win_correction: Trophy,
  cashback_correction: HandCoins,
  aff_correction: Users,
  bet: Ticket,
  win: Trophy,
  refund: RotateCcw,
  cashback_claim: HandCoins,
  aff_transfer: Users,
  bonus: Gift,
  voucher: BadgePercent,
  adjust: SlidersHorizontal,
};

export function TxList({ rows }: { rows: TxRow[] }) {
  const { t: d, lang } = useI18n();
  if (rows.length === 0) {
    return <EmptyState title={d.money.tx.emptyTitle} description={d.money.tx.emptyBody} />;
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => {
        const Icon = ICON[t.type] ?? SlidersHorizontal;
        const positive = t.amount > 0;
        return (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-full",
                t.type === "win" ? "bg-gold-soft text-gold-text" : positive ? "bg-success-soft text-success" : "bg-panel text-ink-2",
              )}
              aria-hidden="true"
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{d.lotto.tx[t.type as keyof typeof d.lotto.tx] ?? t.type}</p>
              <p className="truncate text-xs text-ink-3">
                {formatDateTime(t.created_at, lang)}
                {t.detail && ` · ${t.detail}`}
                {t.ref && <span className="tnum"> · {t.ref}</span>}
              </p>
            </div>
            <div className="text-right">
              <Money satang={t.amount} sign className={cn("block text-sm font-semibold", positive ? (t.type === "win" ? "text-gold-text" : "text-success") : "text-ink")} />
              <span className="tnum block text-xs text-ink-3">{fmt(d.money.tx.balanceAfter, { amount: formatBaht(t.balance_after) })}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
