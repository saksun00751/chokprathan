"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CHANCE_TOTAL, type WheelPrize } from "@/domain/activities";
import { formatBaht } from "@/domain/money";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { spinWheelAction } from "@/server/actions/activities";

const R = 96;
const point = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)] as const;
};

/**
 * The lucky wheel. The server draws the prize; the wheel only turns to it (4–5 s, eased out, or at
 * once with reduced motion) and the balances refresh after it stops so the result is not spoiled.
 * Slots are drawn equal; the real odds are listed under the wheel.
 */
export function LuckyWheel({
  prizes,
  cost,
  turnoverX,
  points,
  spinsLeft,
  signedIn,
}: {
  prizes: WheelPrize[];
  cost: number;
  turnoverX: number;
  points: number;
  /** null = no daily limit */
  spinsLeft: number | null;
  signedIn: boolean;
}) {
  const { t } = useI18n();
  const a = t.site.activities;
  const router = useRouter();
  const toast = useToast();
  const n = prizes.length;
  const seg = 360 / n;
  const [angle, setAngle] = useState(360 - seg / 2);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [pts, setPts] = useState(points);
  const [left, setLeft] = useState(spinsLeft);
  const pending = useRef<{ prize: number; points: number; spinsLeft: number | null } | null>(null);
  const top = Math.max(...prizes.map((p) => p.amount));

  const finish = () => {
    const d = pending.current;
    if (!d) return;
    pending.current = null;
    setSpinning(false);
    setPts(d.points);
    setLeft(d.spinsLeft);
    setResult(d.prize);
    router.refresh();
  };

  const spin = async () => {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    const r = await spinWheelAction();
    if (!r.ok) {
      setSpinning(false);
      toast.error(r.error);
      return;
    }
    pending.current = r.data;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Land the drawn slot under the pointer, a little off-centre so it looks natural (cosmetic only).
    const centre = r.data.slot * seg + seg / 2 + (Math.random() - 0.5) * seg * 0.6;
    const delta = (((360 - centre - (angle % 360)) % 360) + 360) % 360;
    setAngle(angle + (reduced ? 0 : 360 * 6) + delta);
    // transitionend can be skipped (background tab, reduced motion): never leave the result hidden.
    window.setTimeout(finish, reduced ? 0 : 5_000);
  };

  const canSpin = signedIn && !spinning && pts >= cost && left !== 0;
  const label = (p: WheelPrize) => (p.amount > 0 ? `฿${formatBaht(p.amount, { decimals: "auto" })}` : a.tryAgain);
  const fontSize = n > 9 ? 8 : n > 6 ? 9.5 : 11;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-[340px]">
        <svg viewBox="0 0 200 200" className="w-full drop-shadow-[0_8px_24px_rgba(40,20,90,0.25)]" role="img" aria-label={a.wheelTitle}>
          <circle cx="100" cy="100" r="99" fill="var(--color-brand-deep)" />
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: "100px 100px",
              transition: spinning ? "transform 4.6s cubic-bezier(0.12, 0.8, 0.12, 1)" : "none",
            }}
            onTransitionEnd={finish}
          >
            {prizes.map((p, i) => {
              const a0 = i * seg - 90;
              const a1 = (i + 1) * seg - 90;
              const [x0, y0] = point(a0, R);
              const [x1, y1] = point(a1, R);
              const mid = a0 + seg / 2;
              const [tx, ty] = point(mid, R * 0.64);
              const jackpot = p.amount === top && p.amount > 0;
              const fill = jackpot ? "var(--color-gold)" : p.amount === 0 ? "var(--color-panel)" : i % 2 ? "var(--color-brand)" : "var(--color-brand-hover)";
              const ink = jackpot ? "var(--color-ink)" : p.amount === 0 ? "var(--color-ink-2)" : "white";
              return (
                <g key={i}>
                  <path d={`M100,100 L${x0},${y0} A${R},${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1},${y1} Z`} fill={fill} stroke="white" strokeWidth="1.2" />
                  <text
                    x={tx}
                    y={ty}
                    fill={ink}
                    fontSize={fontSize}
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${mid + 90} ${tx} ${ty})`}
                  >
                    {label(p)}
                  </text>
                </g>
              );
            })}
          </g>
          <circle cx="100" cy="100" r="15" fill="white" stroke="var(--color-gold)" strokeWidth="4" />
          <circle cx="100" cy="100" r="5" fill="var(--color-brand-deep)" />
        </svg>
        {/* The pointer stays put at the top. */}
        <svg viewBox="0 0 24 28" className="absolute top-[-6px] left-1/2 w-7 -translate-x-1/2" aria-hidden="true">
          <path d="M12 27 L2 4 Q12 -2 22 4 Z" fill="var(--color-gold)" stroke="var(--color-brand-deep)" strokeWidth="2" />
        </svg>
      </div>

      <div role="status" aria-live="polite" className="min-h-[3.25rem] text-center">
        {result !== null &&
          (result > 0 ? (
            <p className="text-lg font-semibold text-ink">
              {fmt(a.won, { amount: formatBaht(result, { decimals: "auto" }) })}
              {turnoverX > 0 && <span className="block text-xs font-normal text-ink-3">{fmt(a.turnover, { x: turnoverX })}</span>}
            </p>
          ) : (
            <p className="text-ink-2">{a.lost}</p>
          ))}
      </div>

      {signedIn ? (
        <div className="flex flex-col items-center gap-1.5">
          <Button size="lg" onClick={spin} loading={spinning} disabled={!canSpin} className="min-w-52">
            {fmt(a.spin, { n: cost })}
          </Button>
          <p className="text-xs text-ink-3">
            {pts < cost
              ? fmt(a.notEnough, { n: cost })
              : left === null
                ? fmt(a.yourPoints, { n: pts.toLocaleString("en-US") })
                : fmt(a.spinsLeft, { n: left, points: pts.toLocaleString("en-US") })}
          </p>
        </div>
      ) : (
        <Link href="/login?next=/activities" className="font-semibold text-brand hover:underline">
          {a.signIn}
        </Link>
      )}

      <details className="w-full rounded-control bg-panel px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">{a.odds}</summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {[...prizes]
            .sort((x, y) => y.amount - x.amount)
            .map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>{label(p)}</span>
                <span className="tnum text-ink-3">{((p.chance / CHANCE_TOTAL) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%</span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}
