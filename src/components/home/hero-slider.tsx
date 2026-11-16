"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";

const INTERVAL = 5500;

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Swipeable banner slider. Native scroll-snap does the swiping; this component only adds
 * autoplay, dots, arrows and a pause control. Autoplay stops on hover, focus, hidden tab,
 * and for people who prefer reduced motion.
 */
export function HeroSlider({ slides, labels, label }: { slides: ReactNode[]; labels: string[]; label?: string }) {
  const sl = useI18n().t.site.home.slider;
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const count = slides.length;

  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (!el || count === 0) return;
      const n = (i + count) % count;
      el.scrollTo({ left: n * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
    },
    [count, reduced],
  );

  useEffect(() => {
    if (paused || held || reduced || count < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") go(current.current + 1);
    }, INTERVAL);
    return () => window.clearInterval(timer);
  }, [paused, held, reduced, count, go]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== current.current) {
      current.current = i;
      setIndex(i);
    }
  };

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label ?? sl.label}
      className="group/slider relative"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div
        ref={track}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-card shadow-card"
        aria-live={paused || held || reduced ? "polite" : "off"}
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={fmt(sl.slideOf, { n: i + 1, count, label: labels[i] ?? "" })}
            aria-hidden={i !== index || undefined}
            inert={i !== index || undefined}
            className="w-full shrink-0 snap-start snap-always"
          >
            {slide}
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            className="absolute top-1/2 left-3 z-20 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/25 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/slider:opacity-100 focus-visible:opacity-100 md:grid"
            aria-label={sl.prev}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="absolute top-1/2 right-3 z-20 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/25 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/slider:opacity-100 focus-visible:opacity-100 md:grid"
            aria-label={sl.next}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-20 flex items-center justify-center gap-1.5 [&>button]:pointer-events-auto">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={fmt(sl.goTo, { n: i + 1 })}
                aria-current={i === index || undefined}
                className="grid h-6 place-items-center px-0.5"
              >
                <span className={cn("block h-1.5 rounded-full transition-[width,background-color] duration-300", i === index ? "w-5 bg-gold" : "w-1.5 bg-white/50")} />
              </button>
            ))}
            {!reduced && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? sl.play : sl.pause}
                aria-pressed={paused}
                className="ml-1 grid size-6 place-items-center rounded-full text-white/70 hover:text-white"
              >
                {paused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
