import "server-only";
import type { RoundConfig } from "chokprathan-core/rules/roundConfig";
import { json, q, q1 } from "@/server/db";

/** The configuration bets on a round are priced against. The back office writes it. */
export async function getRoundConfig(roundId: number): Promise<{ version: number; config: RoundConfig } | undefined> {
  const row = await q1<{ version: number; config: string }>("SELECT version, config FROM round_configs WHERE round_id = ? ORDER BY version DESC LIMIT 1", roundId);
  const config = row && json.parse<RoundConfig | null>(row.config, null);
  return row && config ? { version: row.version, config } : undefined;
}

/** The version a bill was priced against. */
export async function getRoundConfigVersion(roundId: number, version: number): Promise<RoundConfig | undefined> {
  const row = await q1<{ config: string }>("SELECT config FROM round_configs WHERE round_id = ? AND version = ?", roundId, version);
  return (row && json.parse<RoundConfig | null>(row.config, null)) || undefined;
}

/** `getRoundConfig` for many rounds with one query; rounds without one are left out. */
export async function latestRoundConfigs(roundIds: number[]): Promise<Map<number, RoundConfig>> {
  const out = new Map<number, RoundConfig>();
  if (roundIds.length === 0) return out;
  const rows = await q<{ round_id: number; config: string }>("SELECT round_id, config FROM round_configs WHERE round_id IN (?) ORDER BY version", roundIds);
  for (const r of rows) {
    const config = json.parse<RoundConfig | null>(r.config, null);
    if (config) out.set(r.round_id, config);
  }
  return out;
}
