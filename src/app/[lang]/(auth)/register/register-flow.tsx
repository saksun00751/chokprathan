"use client";

import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { BANKS } from "@/domain/banks";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { bankName as bankLabel } from "@/i18n/labels";
import { cn } from "@/lib/cn";
import { registerAction, requestRegisterOtp, trackReferral, verifyRegisterOtp } from "@/server/actions/auth";

export function RegisterFlow({ initialRef, verifyPhone }: { initialRef: string; verifyPhone: boolean }) {
  const { t } = useI18n();
  const r_ = t.auth.register;
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  const [bankCode, setBankCode] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankName, setBankName] = useState("");
  const [refCode, setRefCode] = useState(initialRef.toUpperCase());

  useEffect(() => {
    if (initialRef) void trackReferral(initialRef);
  }, [initialRef]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const sendOtp = () =>
    start(async () => {
      setError(null);
      const r = await requestRegisterOtp(phone);
      if (!r.ok) return setError(r.error);
      if (r.data.skip) return setStep(1); // phone verification is off on this site
      setOtpSent(true);
      setDemoCode(r.data.demoCode);
      setResendIn(60);
    });

  const confirmOtp = () =>
    start(async () => {
      setError(null);
      const r = await verifyRegisterOtp(phone, otp);
      if (!r.ok) return setError(r.error);
      setStep(1);
    });

  const nextFromPassword = () => {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = r_.nameRequired;
    if (password.length < 8) errs.password = r_.passwordShort;
    if (confirm !== password) errs.confirm = r_.mismatch;
    setFieldErrors(errs);
    if (Object.keys(errs).length === 0) {
      if (!bankName) setBankName(name.trim());
      setStep(2);
    }
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await registerAction({ phone, name, password, confirm, bankCode, bankAccount, bankName, refCode: refCode || undefined });
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        if (r.fieldErrors?.phone) setStep(0);
        else if (r.fieldErrors?.name || r.fieldErrors?.password || r.fieldErrors?.confirm) setStep(1);
        return;
      }
      toast.success(r_.welcome);
      router.replace("/");
      router.refresh();
    });

  return (
    <div className="mt-6">
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label={r_.stepsLabel}>
        {r_.steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-1.5">
            <span className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-brand" : "bg-line")} />
            <span className={cn("text-xs", i === step ? "font-semibold text-ink" : "text-ink-3")}>
              {i < step && <Check className="mr-1 inline size-3.5 text-brand" aria-hidden="true" />}
              {label}
            </span>
          </li>
        ))}
      </ol>

      <FormError message={error} />

      {step === 0 && (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (otpSent) confirmOtp();
            else sendOtp();
          }}
        >
          <Field label={r_.phone} htmlFor="phone" hint={verifyPhone ? r_.phoneHintOtp : r_.phoneHint}>
            <Input
              id="phone"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="08x-xxx-xxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d-]/g, ""))}
              disabled={otpSent}
              required
            />
          </Field>
          {otpSent && (
            <Field label={r_.otp} htmlFor="otp" hint={fmt(r_.otpSent, { phone })}>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className="tnum text-lg tracking-[0.3em]"
                autoFocus
                required
              />
            </Field>
          )}
          {demoCode && (
            <p className="rounded-control bg-brand-soft px-3 py-2 text-sm text-brand-soft-ink">
              {r_.demoCode} <b className="tnum tracking-wider">{demoCode}</b>
            </p>
          )}
          <Button type="submit" size="lg" loading={pending}>
            {otpSent ? r_.verifyPhone : verifyPhone ? r_.requestCode : r_.next}
          </Button>
          {otpSent && (
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => { setOtpSent(false); setOtp(""); setDemoCode(null); }}>
                {r_.changePhone}
              </button>
              <button type="button" className="font-medium text-brand disabled:text-ink-3" disabled={resendIn > 0 || pending} onClick={sendOtp}>
                {resendIn > 0 ? fmt(r_.resendIn, { n: resendIn }) : r_.resend}
              </button>
            </div>
          )}
        </form>
      )}

      {step === 1 && (
        <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); nextFromPassword(); }}>
          <Field label={r_.name} htmlFor="name" error={fieldErrors.name} hint={r_.nameHint}>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldErrors.name || undefined} required />
          </Field>
          <Field label={r_.password} htmlFor="password" error={fieldErrors.password} hint={r_.passwordHint}>
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-12"
                aria-invalid={!!fieldErrors.password || undefined}
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-control text-ink-3 hover:text-ink"
                aria-label={show ? t.auth.login.hidePassword : t.auth.login.showPassword}
                aria-pressed={show}
              >
                {show ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
              </button>
            </div>
          </Field>
          <Field label={r_.confirm} htmlFor="confirm" error={fieldErrors.confirm}>
            <Input id="confirm" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!fieldErrors.confirm || undefined} required />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setStep(0)}>
              {r_.back}
            </Button>
            <Button type="submit" size="lg" className="flex-1">
              {r_.next}
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label={r_.bank} htmlFor="bank" error={fieldErrors.bankCode}>
            <Select id="bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} required aria-invalid={!!fieldErrors.bankCode || undefined}>
              <option value="" disabled>
                {r_.pickBank}
              </option>
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {bankLabel(b.code, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={r_.account} htmlFor="bankAccount" error={fieldErrors.bankAccount} hint={r_.accountHint}>
            <Input id="bankAccount" inputMode="numeric" value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/[^\d-]/g, ""))} aria-invalid={!!fieldErrors.bankAccount || undefined} required />
          </Field>
          <Field label={r_.accountName} htmlFor="bankName" error={fieldErrors.bankName}>
            <Input id="bankName" value={bankName} onChange={(e) => setBankName(e.target.value)} aria-invalid={!!fieldErrors.bankName || undefined} required />
          </Field>
          <Field label={r_.referrer} htmlFor="refCode" optional>
            <Input id="refCode" value={refCode} onChange={(e) => setRefCode(e.target.value.toUpperCase())} maxLength={12} className="uppercase" />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setStep(1)}>
              {r_.back}
            </Button>
            <Button type="submit" size="lg" className="flex-1" loading={pending}>
              {r_.submit}
            </Button>
          </div>
          <p className="text-xs text-ink-3">{r_.consent}</p>
        </form>
      )}
    </div>
  );
}
