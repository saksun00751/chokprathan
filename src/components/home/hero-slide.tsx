"use client";

import Link from "next/link";
import Image from "next/image";
import { Guilloche } from "@/components/brand/guilloche";
import { BannerArt } from "@/components/art/scenes";
import { ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/clock";
import { parseHighlight } from "@/domain/banner";
import type { SlideView } from "@/server/data/banners";
import { useI18n } from "@/i18n/client";

const TONE_BG: Record<SlideView["tone"], string> = {
  violet: "radial-gradient(110% 120% at 88% 40%, var(--slide-glow) 0%, transparent 58%), linear-gradient(118deg, var(--slide-from), var(--slide-to))",
  gold: "radial-gradient(110% 120% at 88% 45%, oklch(0.74 0.15 76 / 0.6) 0%, transparent 56%), linear-gradient(118deg, var(--slide-alt-from), var(--slide-alt-to))",
  red: "radial-gradient(110% 120% at 88% 45%, oklch(0.6 0.21 26 / 0.7) 0%, transparent 56%), linear-gradient(118deg, var(--slide-alt-from), var(--slide-alt-to))",
  night:
    "radial-gradient(110% 120% at 88% 40%, oklch(0.55 0.15 250 / 0.65) 0%, transparent 58%), linear-gradient(118deg, oklch(0.27 0.1 280), oklch(0.15 0.06 280))",
};

function Title({ text }: { text: string }) {
  return (
    <>
      {parseHighlight(text).map((s, i) =>
        s.hl ? (
          <span key={i} className="text-gold">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function HeroSlide({ slide, serverNow, priority = false }: { slide: SlideView; serverNow: number; priority?: boolean }) {
  const { t } = useI18n();
  const plainTitle = slide.title.replace(/[[\]]/g, "");

  if (slide.imageUrl && !slide.showText) {
    return (
      <Link href={slide.ctaHref} className="relative block h-[216px] overflow-hidden sm:h-[260px] lg:h-[300px]" aria-label={plainTitle}>
        <Image src={slide.imageUrl} alt={plainTitle} fill sizes="(min-width: 1280px) 1136px, 100vw" className="object-cover" priority={priority} unoptimized />
      </Link>
    );
  }

  return (
    <article className="relative h-[216px] overflow-hidden text-white sm:h-[260px] lg:h-[300px]" style={{ background: TONE_BG[slide.tone] }}>
      {slide.imageUrl ? (
        <>
          <Image src={slide.imageUrl} alt="" fill sizes="(min-width: 1280px) 1136px, 100vw" className="object-cover" priority={priority} unoptimized />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--slide-shade)_88%,transparent)_0%,color-mix(in_oklch,var(--slide-shade)_55%,transparent)_45%,transparent_75%)]" />
        </>
      ) : (
        <>
          <Guilloche className="absolute -bottom-48 -left-40 size-[460px] text-white" strokeOpacity={0.08} />
          <div className="absolute top-[5%] right-[1%] bottom-[12%] w-[44%] sm:right-[4%] sm:w-[40%] lg:w-[36%]">
            <BannerArt art={slide.art} label={slide.artLabel ?? t.common.brand} />
          </div>
        </>
      )}
      <div className="relative z-10 flex h-full max-w-[60%] flex-col justify-center gap-1.5 p-4 pb-7 sm:max-w-[56%] sm:gap-2.5 sm:p-8 md:pl-16 lg:p-10 lg:pl-16">
        {slide.tag && <span className="self-start rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-ink">{slide.tag}</span>}
        <h2 className="text-[1.4rem] leading-[1.2] font-semibold tracking-tight sm:text-3xl lg:text-[2.5rem]">
          <Title text={slide.title} />
        </h2>
        {slide.countdownTo ? (
          <p className="text-sm text-on-deep-2">
            {t.site.home.slider.closesIn} <Countdown closesAt={slide.countdownTo} serverNow={serverNow} className="text-white" />
          </p>
        ) : (
          slide.subtitle && <p className="line-clamp-2 text-sm text-on-deep-2 sm:text-base">{slide.subtitle}</p>
        )}
        {slide.ctaLabel && (
          <ButtonLink href={slide.ctaHref} variant="gold" size="sm" className="mt-1 self-start sm:h-11 sm:px-5 sm:text-base">
            {slide.ctaLabel}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}
