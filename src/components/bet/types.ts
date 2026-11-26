import type { BetTypeCode } from "chokprathan-core/rules/types";
import type { BetConfigView } from "@/server/data/bet";
import type { LimitBadge } from "@/server/services/risk";

export type SlipItem = { key: string; betType: BetTypeCode; number: string; stake: number };
export type ConfigMap = Map<BetTypeCode, BetConfigView>;
export type BadgeMap = Map<string, LimitBadge>;

export const itemKey = (betType: string, number: string) => `${betType}:${number}`;
