"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { redeemVoucherAction } from "@/server/actions/wallet";

export function RedeemForm() {
  const v = useI18n().t.money.vouchers;
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await redeemVoucherAction(code);
          if (!r.ok) return setError(r.error);
          setError(null);
          setCode("");
          toast.success(r.message ?? v.redeemed);
        });
      }}
    >
      <Field label={v.code} htmlFor="voucher" error={error} hint={v.demoHint}>
        <Input
          id="voucher"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          className="tnum uppercase tracking-[0.1em]"
          aria-invalid={!!error || undefined}
        />
      </Field>
      <Button type="submit" size="lg" loading={pending} disabled={!code.trim()}>
        {v.submit}
      </Button>
    </form>
  );
}
