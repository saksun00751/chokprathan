"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { requestWithdrawalAction } from "@/server/actions/wallet";

export function WithdrawForm({ balance, min, max, blocked }: { balance: number; min: number; max: number; blocked: string | null }) {
  const w_ = useI18n().t.money.withdraw;
  const toast = useToast();
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = Math.min(Math.floor(balance / 100), Math.floor(max / 100));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await requestWithdrawalAction(amount);
          if (!r.ok) return setError(r.error);
          toast.success(r.message ?? w_.sent);
          setAmount(0);
        });
      }}
    >
      <FormError message={blocked ?? error} />
      <label htmlFor="withdraw-amount" className="text-sm font-semibold">
        {w_.amount}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xl font-semibold text-ink-3">฿</span>
        <input
          id="withdraw-amount"
          inputMode="numeric"
          disabled={!!blocked}
          value={amount ? String(amount) : ""}
          onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 7)) || 0)}
          placeholder={String(min / 100)}
          className="tnum h-14 w-full rounded-control border border-line-strong bg-surface pr-4 pl-10 text-2xl font-semibold placeholder:text-ink-3 focus-visible:border-brand disabled:bg-panel"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[100, 500, 1000].map((v) => (
          <button key={v} type="button" disabled={!!blocked} onClick={() => setAmount(v)} className="tnum h-10 rounded-control border border-line bg-surface text-sm font-semibold hover:border-brand/40 disabled:opacity-50">
            ฿{formatNumber(v)}
          </button>
        ))}
        <button type="button" disabled={!!blocked || all <= 0} onClick={() => setAmount(all)} className="h-10 rounded-control border border-line bg-surface text-sm font-semibold hover:border-brand/40 disabled:opacity-50">
          {w_.all}
        </button>
      </div>
      <Button type="submit" size="lg" loading={pending} disabled={!!blocked || amount * 100 < min}>
        {w_.submit}
      </Button>
    </form>
  );
}
