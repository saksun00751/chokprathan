"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatBaht } from "@/core/rules/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { fmt, formatDateTime } from "@/i18n/format";
import { placeGuessAction } from "@/server/actions/activities";
import type { MyGuess } from "@/server/data/activities";

const TONE = { pending: "brand", won: "success", lost: "outline", refunded: "warning" } as const;

/** Guess a round's bottom two digits with points; settled automatically when the result is entered. */
export function GuessGame({
  rounds,
  cost,
  prize,
  maxPerRound,
  turnoverX,
  shared,
  guesses,
  points,
  signedIn,
}: {
  rounds: { id: number; label: string; closesAt: number }[];
  cost: number;
  prize: number;
  maxPerRound: number;
  turnoverX: number;
  /** winners split a round budget when there are many */
  shared: boolean;
  guesses: MyGuess[];
  points: number;
  signedIn: boolean;
}) {
  const { lang, t } = useI18n();
  const a = t.site.activities;
  const toast = useToast();
  const [pending, start] = useTransition();
  const [roundId, setRoundId] = useState(rounds[0]?.id ?? 0);
  const [number, setNumber] = useState("");
  const mine = guesses.filter((g) => g.roundId === roundId);
  const round = rounds.find((r) => r.id === roundId);
  const full = mine.length >= maxPerRound;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {fmt(a.guessRule, { n: cost, prize: formatBaht(prize, { decimals: "auto" }), max: maxPerRound })}
        {shared && ` ${a.guessShared}`}
        {turnoverX > 0 && ` ${fmt(a.turnover, { x: turnoverX })}`}
      </p>

      {rounds.length === 0 ? (
        <p className="rounded-control bg-panel px-3 py-3 text-sm text-ink-3">{a.noRounds}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await placeGuessAction(roundId, number);
              if (r.ok) {
                toast.success(r.message ?? a.guessed);
                setNumber("");
              } else toast.error(r.error);
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-ink-3">{a.round}</span>
            <select
              value={roundId}
              onChange={(e) => setRoundId(Number(e.target.value))}
              className="h-11 rounded-control border border-line-strong bg-surface px-3"
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {fmt(a.closes, { time: formatDateTime(r.closesAt, lang) })}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-ink-3">{a.number}</span>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="00"
                maxLength={2}
                aria-describedby="guess-mine"
                className="tnum h-12 w-24 rounded-control border border-line-strong bg-surface text-center text-2xl font-semibold tracking-[0.3em]"
              />
            </label>
            {signedIn ? (
              <Button type="submit" size="lg" loading={pending} disabled={number.length !== 2 || full || points < cost}>
                {fmt(a.guess, { n: cost })}
              </Button>
            ) : (
              <Link href="/login?next=/activities" className="mb-3 font-semibold text-brand hover:underline">
                {a.signIn}
              </Link>
            )}
          </div>
          {signedIn && (
            <p id="guess-mine" className="text-xs text-ink-3">
              {round && mine.length > 0
                ? fmt(a.yourNumbers, { list: mine.map((g) => g.number).join(", "), n: mine.length, max: maxPerRound })
                : fmt(a.yourPoints, { n: points.toLocaleString("en-US") })}
            </p>
          )}
        </form>
      )}

      {guesses.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">{a.history}</p>
          <ul className="divide-y divide-line rounded-control border border-line">
            {guesses.slice(0, 12).map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  <span className="tnum mr-2 text-base font-semibold tracking-[0.15em]">{g.number}</span>
                  <span className="text-ink-2">{g.label}</span>
                </span>
                <Badge tone={TONE[g.status]}>
                  {g.status === "won" ? fmt(a.statusWon, { amount: formatBaht(g.paid, { decimals: "auto" }) }) : a.status[g.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
