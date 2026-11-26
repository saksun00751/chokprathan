import "server-only";
import { advertisedRates } from "@/domain/bet-packages";
import { getRoundConfig } from "@/server/services/round-config";
import { scheduledClose } from "@/i18n/labels";
import { io } from "next/cache";
import type { ArtKey } from "@/components/art/keys";
import { formatRate } from "@/core/rules/money";
import { fmt, formatDate } from "@/i18n/format";
import { getI18n } from "@/i18n/rsc";
import { q1 } from "@/server/db";
import { listBanners, type Tone } from "@/server/services/banners";
import { betConfigs, getLotto } from "@/server/services/lottos";
import { toRound, type RoundRow } from "@/server/services/rounds";
import { getSettings } from "@/server/services/settings";

export interface SlideView {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  art: ArtKey;
  tone: Tone;
  imageUrl: string | null;
  showText: boolean;
  countdownTo: number | null;
  artLabel?: string;
}

/** Admin banners plus one live slide for the next Thai government draw. */
export async function getHomeSlides(loggedIn: boolean): Promise<{ serverNow: number; slides: SlideView[] }> {
  const { lang, t } = await getI18n();
  const g = t.site.home.govSlide;
  await io();
  const now = Date.now();
  const slides: SlideView[] = (await listBanners({ activeOnly: true })).map((b) => {
    const tr = lang === "th" ? undefined : b.i18n[lang];
    const pick = (k: "tag" | "title" | "subtitle" | "ctaLabel") => tr?.[k] || b[k];
    return {
    id: `b${b.id}`,
    tag: pick("tag"),
    title: pick("title"),
    subtitle: pick("subtitle"),
    // members are already registered: send sign-up banners to the deposit page instead
    ctaLabel: loggedIn && b.ctaHref === "/register" ? g.depositBonus : pick("ctaLabel"),
    ctaHref: loggedIn && b.ctaHref === "/register" ? "/wallet/deposit" : b.ctaHref,
    art: b.art,
    tone: b.tone,
    imageUrl: b.image ? `/media/${b.image}` : null,
    showText: b.showText,
    countdownTo: null,
    };
  });

  const gov = await q1<RoundRow>(
    `SELECT r.* FROM rounds r JOIN lottos l ON l.id = r.lotto_id
     WHERE l.slug = 'thai-gov' AND l.enabled = 1 AND r.status = 'scheduled' AND r.opens_at <= ? AND r.closes_at > ?
     ORDER BY r.closes_at LIMIT 1`,
    now,
    now,
  );
  if (gov) {
    const round = toRound(gov);
    const lotto = (await getLotto(round.lottoId))!;
    const current = betConfigs(lotto, await getSettings());
    const rate = advertisedRates((await getRoundConfig(round.id))?.config, current).find((c) => c.code === "top3")?.rate100 ?? 95000;
    slides.splice(Math.min(1, slides.length), 0, {
      id: "gov",
      tag: g.tag,
      title: fmt(g.title, { date: formatDate(scheduledClose(round), lang), rate: formatRate(rate) }),
      subtitle: g.subtitle,
      ctaLabel: g.cta,
      ctaHref: `/lotto/${round.id}`,
      art: "ticket",
      tone: "gold",
      imageUrl: null,
      showText: true,
      countdownTo: round.closesAt,
      artLabel: fmt(t.lotto.round.dated, { date: formatDate(scheduledClose(round), lang) }),
    });
  }
  return { serverNow: now, slides };
}
