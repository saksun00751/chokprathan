"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { useI18n } from "@/i18n/client";
import { loginAction, type LoginState } from "@/server/actions/auth";

const DEMO = [{ label: "demoMember", identifier: "0812345678", password: "demo1234" }] as const;

type LoginProps = { next: string; demoMode: boolean };

/** Customer sign-in: members by phone number. Staff sign in on /console. */
export function LoginForm({ next, demoMode }: LoginProps) {
  const l = useI18n().t.auth.login;
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error} />
      <Field label={l.phone} htmlFor="identifier">
        <Input
          ref={idRef}
          id="identifier"
          name="identifier"
          autoComplete="username"
          inputMode="tel"
          placeholder="08x-xxx-xxxx"
          defaultValue={state.identifier}
          required
          aria-invalid={!!state.error || undefined}
        />
      </Field>
      <Field label={l.password} htmlFor="password">
        <div className="relative">
          <Input
            ref={pwRef}
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-12"
            aria-invalid={!!state.error || undefined}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-control text-ink-3 hover:text-ink"
            aria-label={show ? l.hidePassword : l.showPassword}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </Field>
      <div className="-mt-1 flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
          {l.forgot}
        </Link>
      </div>
      <Button type="submit" size="lg" loading={pending}>
        {l.submit}
      </Button>
      <p className="text-center text-sm text-ink-2">
        {l.noAccount}{" "}
        <Link href="/register" className="font-semibold text-brand hover:underline">
          {l.register}
        </Link>
      </p>

      {demoMode && (
        <div className="mt-2 rounded-card border border-dashed border-line-strong bg-surface p-4">
          <p className="text-sm font-semibold text-ink">{l.demoTitle}</p>
          <p className="mt-0.5 text-sm text-ink-2">{l.demoBody}</p>
          <div className="mt-3 grid grid-cols-1 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.identifier}
                type="button"
                onClick={() => {
                  if (idRef.current) idRef.current.value = d.identifier;
                  if (pwRef.current) pwRef.current.value = d.password;
                  pwRef.current?.form?.requestSubmit();
                }}
                className="flex flex-col items-start rounded-control border border-line bg-canvas px-3 py-2 text-left hover:border-brand"
              >
                <span className="text-sm font-semibold text-ink">{l[d.label]}</span>
                <span className="tnum text-xs text-ink-3">{d.identifier}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
