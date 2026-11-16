"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatRemaining, useNow } from "@/components/ui/clock";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { fmt, formatClock } from "@/i18n/format";
import { cancelBillAction } from "@/server/actions/bills";

export function CancelBill({ billId, until, serverNow }: { billId: number; until: number; serverNow: number }) {
  const { t } = useI18n();
  const bl = t.play.bill;
  const toast = useToast();
  const now = useNow(serverNow);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const left = until - now;
  if (left <= 0) return null;

  if (!confirming) {
    return (
      <Button variant="dangerGhost" onClick={() => setConfirming(true)} className="border border-danger/30">
        {bl.cancel} <span className="tnum text-xs font-normal">{fmt(bl.cancelLeft, { left: formatRemaining(left, t.common.countdown.days).replace(/^00:/, "") })}</span>
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-control bg-danger-soft p-3 sm:w-auto">
      <p className="text-sm text-danger">{fmt(bl.cancelConfirmText, { time: formatClock(until) })}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelBillAction(billId);
              if (r.ok) toast.success(r.message ?? bl.cancelled);
              else toast.error(r.error);
              setConfirming(false);
            })
          }
        >
          {bl.confirmCancel}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {bl.keep}
        </Button>
      </div>
    </div>
  );
}
