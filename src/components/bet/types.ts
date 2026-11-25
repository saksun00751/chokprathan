import type { BetTypeCode } from "chokprathan-core/rules/types";
import type { BetConfigView } from "@/server/data/bet";
import type { LimitBadge } from "@/server/services/risk";

export type SlipItem = { key: string; betType: BetTypeCode; number: string; stake: number };
export type ConfigMap = Map<BetTypeCode, BetConfigView>;
export type BadgeMap = Map<string, LimitBadge>;

export const itemKey = (betType: string, number: string) => `${betType}:${number}`;

/** Current rate for a number: the cut rate when it has one, otherwise the base rate. null = closed. */
export function liveRate(badges: BadgeMap, cfg: BetConfigView, number: string): number | null {
  const badge = badges.get(itemKey(cfg.code, number));
  return badge ? badge.rate100 : cfg.rate100;
}
