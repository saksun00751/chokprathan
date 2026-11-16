"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { requestResetOtp, resetPasswordAction, verifyResetOtp } from "@/server/actions/auth";

export function ResetFlow() {
  const { t } = useI18n();
  const r_ = t.auth.reset;
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<"phone" | "otp" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          if (stage === "phone") {
            const r = await requestResetOtp(phone);
            if (!r.ok) return setError(r.error);
            setDemoCode(r.data.demoCode);
            setStage("otp");
          } else if (stage === "otp") {
            const r = await verifyResetOtp(phone, otp);
            if (!r.ok) return setError(r.error);
            setStage("password");
          } else {
            const r = await resetPasswordAction(phone, password, confirm);
            if (!r.ok) {
              setError(r.error);
              setFieldErrors(r.fieldErrors ?? {});
              return;
            }
            toast.success(r_.done);
            router.replace("/");
            router.refresh();
          }
        });
      }}
    >
      <FormError message={error} />
      <Field label={r_.phone} htmlFor="phone">
        <Input id="phone" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={stage !== "phone"} required />
      </Field>
      {stage !== "phone" && (
        <>
          <p className="text-sm text-ink-2">{r_.sentIfExists}</p>
          {demoCode && (
            <p className="rounded-control bg-brand-soft px-3 py-2 text-sm text-brand-soft-ink">
              {t.auth.register.demoCode} <b className="tnum tracking-wider">{demoCode}</b>
            </p>
          )}
          <Field label={r_.otp} htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} disabled={stage === "password"} className="tnum tracking-[0.3em]" required />
          </Field>
        </>
      )}
      {stage === "password" && (
        <>
          <Field label={r_.newPassword} htmlFor="password" hint={r_.hint} error={fieldErrors.password}>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Field label={r_.confirm} htmlFor="confirm" error={fieldErrors.confirm}>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
        </>
      )}
      <Button type="submit" size="lg" loading={pending}>
        {stage === "phone" ? r_.requestCode : stage === "otp" ? r_.verifyCode : r_.save}
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-ink-2 hover:text-ink">
        {r_.backToLogin}
      </Link>
    </form>
  );
}
