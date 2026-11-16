"use client";

import Link from "next/link";
import { CircleCheck, Copy, Hourglass, ImageUp } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Countdown, ServerTimeSync } from "@/components/ui/clock";
import { FormError } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatBaht } from "@/domain/money";
import { useI18n } from "@/i18n/client";
import { fmt, formatNumber } from "@/i18n/format";
import { bankName as bankFullName, bankShort } from "@/i18n/labels";
import { cn } from "@/lib/cn";
import { cancelDepositAction, confirmDepositAction, createDepositAction, uploadSlipAction } from "@/server/actions/wallet";
import { pointsFor } from "@/domain/points";
import type { getDepositPage } from "@/server/data/wallet";
import type { Deposit } from "@/server/services/finance";

type Data = Awaited<ReturnType<typeof getDepositPage>>;
const QUICK = [100, 300, 500, 1000, 2000, 5000];

/** Phone photos are large: shrink to 1600px JPEG before upload (the server still checks the bytes). */
async function shrink(file: File): Promise<Blob> {
  if (file.size <= 700_000 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function SlipPicker({ depositId, attached, onAttached }: { depositId: number; attached: boolean; onAttached: () => void }) {
  const d = useI18n().t.money.deposit;
  const toast = useToast();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{d.slip}</p>
          <p className="text-xs text-ink-3">{attached ? d.slipAttached : d.slipHint}</p>
        </div>
        <Button type="button" variant={attached ? "secondary" : "primary"} size="sm" loading={pending} onClick={() => input.current?.click()}>
          <ImageUp className="size-4" aria-hidden="true" />
          {attached ? d.changeImage : d.attach}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label={d.pickImage}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            start(async () => {
              const blob = await shrink(file);
              const form = new FormData();
              form.set("slip", new File([blob], "slip.jpg", { type: blob.type || "image/jpeg" }));
              const r = await uploadSlipAction(depositId, form);
              if (!r.ok) return toast.error(r.error);
              setPreview((old) => {
                if (old) URL.revokeObjectURL(old);
                return URL.createObjectURL(blob);
              });
              onAttached();
              toast.success(d.attachedToast);
            });
          }}
        />
      </div>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={d.attachedAlt} className="mt-3 max-h-56 rounded-control border border-line object-contain" />
      )}
    </div>
  );
}

export function DepositFlow({
  data,
  initialPromo,
  bankCode,
  bankName,
}: {
  data: Data;
  initialPromo: number | null;
  bankCode: string | null;
  bankName: string | null;
}) {
  const { t } = useI18n();
  const d = t.money.deposit;
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(500);
  const [promoId, setPromoId] = useState<number | null>(initialPromo && data.promos.some((p) => p.id === initialPromo && !p.used) ? initialPromo : null);
  const [deposit, setDeposit] = useState<Deposit | null>(data.active);
  const [slip, setSlip] = useState<boolean>(!!data.active?.hasSlip);
  const [done, setDone] = useState<{ approved: boolean; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(fmt(d.copied, { what }));
    } catch {
      toast.error(d.copyFailed);
    }
  };

  if (done) {
    return (
      <Card className="max-w-xl p-6 text-center">
        <span
          className={cn(
            "mx-auto grid size-16 animate-pop place-items-center rounded-full",
            done.approved ? "bg-success-soft text-success" : "bg-brand-soft text-brand",
          )}
        >
          {done.approved ? <CircleCheck className="size-9" aria-hidden="true" /> : <Hourglass className="size-8" aria-hidden="true" />}
        </span>
        <p className="mt-4 text-lg font-semibold">{done.approved ? d.approvedTitle : d.pendingTitle}</p>
        <p className="tnum mt-1 text-2xl font-semibold">฿{formatBaht(done.amount)}</p>
        <p className="mt-2 text-sm text-ink-2">{done.approved ? d.approvedBody : d.pendingBody}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <ButtonLink href="/wallet" variant="secondary" size="lg">
            {d.goWallet}
          </ButtonLink>
          <ButtonLink href="/lotto" size="lg">
            {d.goBet}
          </ButtonLink>
        </div>
      </Card>
    );
  }

  if (deposit?.toBank) {
    const whole = formatBaht(deposit.amount).split(".");
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <ServerTimeSync serverNow={data.serverNow} />
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{d.exact}</p>
            <span className="text-xs text-ink-3">
              {d.expiresIn} <Countdown closesAt={deposit.expiresAt} serverNow={data.serverNow} closedLabel={d.expired} />
            </span>
          </div>
          <button
            type="button"
            onClick={() => copy(formatBaht(deposit.amount).replace(/,/g, ""), d.amountWord)}
            className="mt-3 flex w-full items-center justify-between rounded-control bg-panel px-4 py-3 text-left hover:bg-line"
          >
            <span className="tnum text-[2rem] leading-tight font-semibold">
              ฿{whole[0]}.<span className="rounded bg-gold px-1 text-ink">{whole[1]}</span>
            </span>
            <Copy className="size-5 text-ink-3" aria-label={d.copyAmount} />
          </button>
          <p className="mt-2 text-xs text-ink-3">{d.satangHint}</p>

          <dl className="mt-5 flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-ink-3">{d.toBank}</dt>
              <dd className="font-semibold">{bankFullName(deposit.toBank.bank, t)}</dd>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <dt className="text-ink-3">{d.account}</dt>
                <dd className="tnum text-lg font-semibold tracking-[0.06em]">{deposit.toBank.account}</dd>
              </div>
              <Button variant="secondary" size="sm" onClick={() => copy(deposit.toBank!.account, d.accountWord)}>
                <Copy className="size-4" aria-hidden="true" />
                {t.common.copy}
              </Button>
            </div>
            <div>
              <dt className="text-ink-3">{d.accountName}</dt>
              <dd className="font-semibold">{deposit.toBank.name}</dd>
            </div>
          </dl>
        </Card>

        <ul className="flex flex-col gap-1.5 rounded-control bg-warning-soft px-4 py-3 text-sm text-warning">
          <li>{fmt(d.fromOwn, { bank: bankCode ? bankShort(bankCode, t) : "", name: bankName ?? d.you })}</li>
          <li>{d.once}</li>
        </ul>
        {data.autoApprove ? (
          <p className="rounded-control bg-brand-soft px-4 py-3 text-sm text-brand-soft-ink">{d.demo}</p>
        ) : (
          <SlipPicker depositId={deposit.id} attached={slip} onAttached={() => setSlip(true)} />
        )}
        <FormError message={error} />
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button
            variant="ghost"
            size="lg"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await cancelDepositAction(deposit.id);
                setDeposit(null);
              })
            }
          >
            {d.cancel}
          </Button>
          <Button
            size="lg"
            loading={pending}
            disabled={data.slipRequired && !slip}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await confirmDepositAction(deposit.id);
                if (!r.ok) return setError(r.error);
                setDone({ approved: r.data.approved, amount: deposit.amount });
              })
            }
          >
            {d.paid}
          </Button>
        </div>
      </div>
    );
  }

  if (!data.hasAccount) {
    return (
      <Card className="max-w-xl p-6">
        <p className="font-semibold">{d.unavailableTitle}</p>
        <p className="mt-1 text-sm text-ink-2">{d.unavailableBody}</p>
      </Card>
    );
  }

  const promo = data.promos.find((p) => p.id === promoId);
  const bonus = promo ? Math.min(Math.floor((amount * 100 * promo.bonusPercent) / 100), promo.maxBonus || Infinity) : 0;

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await createDepositAction(amount, promoId);
          if (!r.ok) return setError(r.error);
          setSlip(false);
          setDeposit(r.data);
        });
      }}
    >
      <Card className="p-5">
        <label htmlFor="amount" className="text-sm font-semibold">
          {d.amount}
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xl font-semibold text-ink-3">฿</span>
          <input
            id="amount"
            inputMode="numeric"
            value={amount ? String(amount) : ""}
            onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 7)) || 0)}
            className="tnum h-14 w-full rounded-control border border-line-strong bg-surface pr-4 pl-10 text-2xl font-semibold focus-visible:border-brand"
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={amount === q}
              onClick={() => setAmount(q)}
              className={cn(
                "tnum h-11 rounded-control border text-sm font-semibold transition-colors",
                amount === q ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface hover:border-brand/40",
              )}
            >
              ฿{formatNumber(q)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">
          {fmt(d.limits, { min: formatBaht(data.min, { decimals: "auto" }), max: formatBaht(data.max, { decimals: "auto" }) })}
        </p>
        {data.pointRule.enabled && (
          <p className="mt-1 text-xs text-ink-2">
            {fmt(t.money.wallet.pointsRule, {
              amount: formatBaht(data.pointRule.every, { decimals: "auto" }),
              n: data.pointRule.points.toLocaleString("en-US"),
            })}
            {pointsFor(Math.round(amount * 100), data.pointRule) > 0 && (
              <span className="font-semibold text-ink">
                {" "}
                · {fmt(d.pointsThis, { n: pointsFor(Math.round(amount * 100), data.pointRule).toLocaleString("en-US") })}
              </span>
            )}
          </p>
        )}
      </Card>

      {data.promos.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{d.promoLegend}</legend>
          <PromoOption checked={promoId === null} onSelect={() => setPromoId(null)} title={d.noPromo} summary={d.noPromoBody} />
          {data.promos.map((p) => {
            const tooLow = amount * 100 < p.minDeposit;
            return (
              <PromoOption
                key={p.id}
                checked={promoId === p.id}
                disabled={p.used || tooLow}
                onSelect={() => setPromoId(p.id)}
                title={p.title}
                summary={
                  p.used
                    ? d.promoUsed
                    : tooLow
                      ? fmt(d.promoMin, { amount: formatBaht(p.minDeposit, { decimals: "auto" }) })
                      : fmt(d.promoTurnover, { summary: p.summary, x: p.turnoverX })
                }
              />
            );
          })}
        </fieldset>
      )}

      <FormError message={error} />
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <div>
          <p className="text-xs text-ink-3">{d.receive}</p>
          <p className="tnum text-xl font-semibold">
            ฿{formatBaht(amount * 100 + bonus, { decimals: "auto" })}
            {bonus > 0 && (
              <span className="ml-2 text-sm font-medium text-success">{fmt(d.withBonus, { amount: formatBaht(bonus, { decimals: "auto" }) })}</span>
            )}
          </p>
        </div>
        <Button type="submit" size="lg" loading={pending} disabled={!amount}>
          {d.create}
        </Button>
      </div>
      <p className="text-sm text-ink-3">
        {d.haveVoucher}{" "}
        <Link href="/vouchers" className="font-semibold text-brand hover:underline">
          {d.enterVoucher}
        </Link>
      </p>
    </form>
  );
}

function PromoOption({
  checked,
  disabled,
  onSelect,
  title,
  summary,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  summary: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors",
        checked ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name="promo" checked={checked} disabled={disabled} onChange={onSelect} className="mt-1 size-4 accent-[var(--color-brand)]" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-sm text-ink-2">{summary}</span>
      </span>
    </label>
  );
}
