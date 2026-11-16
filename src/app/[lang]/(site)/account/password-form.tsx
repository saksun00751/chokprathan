"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { changePasswordAction } from "@/server/actions/account";

export function PasswordForm() {
  const a = useI18n().t.auth.account;
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      ref={form}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await changePasswordAction(String(fd.get("current")), String(fd.get("next")), String(fd.get("confirm")));
          if (!r.ok) {
            setErrors(r.fieldErrors ?? { current: r.error });
            return;
          }
          setErrors({});
          form.current?.reset();
          toast.success(r.message ?? a.changed);
        });
      }}
    >
      <Field label={a.current} htmlFor="current" error={errors.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={a.newPassword} htmlFor="next" error={errors.next} hint={a.hint}>
        <Input id="next" name="next" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={a.confirm} htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" loading={pending} className="self-start">
        {a.save}
      </Button>
    </form>
  );
}
