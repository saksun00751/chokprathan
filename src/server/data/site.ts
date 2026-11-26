import "server-only";
import { io } from "next/cache";
import { getSettings } from "@/server/services/settings";

export async function getSiteInfo() {
  await io();
  const { site, rewards } = await getSettings();
  const pct = (bp: number) => String(Math.round(bp) / 100);
  return {
    cashbackPct: pct(rewards.cashbackBp),
    affPct: pct(rewards.aff1Bp),
    /** Per-language announcement, falling back to the Thai text. */
    announcementI18n: site.announcementI18n ?? {},
    demoMode: site.demoMode,
    lineId: site.lineId,
    phone: site.phone,
    announcement: site.announcement,
    cancelWindowMin: site.cancelWindowMin,
    cancelCutoffMin: site.cancelCutoffMin,
    otpRequired: site.otpRequired,
    registrationOpen: site.registrationOpen,
  };
}
