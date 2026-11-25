import "server-only";
import { withBuiltins, type LottoGroupInfo } from "@/domain/lotto-groups";
import { memo } from "@/server/cache";
import { json, q, tolerateMissingTable } from "@/server/db";

type Row = { code: string; name: string; i18n: string; art: string; sort: number };

/** The groups staff manage in the back office, cached briefly. The built-ins alone before migration 10. */
export function listGroups(): Promise<LottoGroupInfo[]> {
  return memo("lotto-groups", 5_000, async () => {
    const rows = await tolerateMissingTable(() => q<Row>("SELECT code, name, i18n, art, sort FROM lotto_groups"), []);
    return withBuiltins(rows.map((r) => ({ ...r, i18n: json.parse<LottoGroupInfo["i18n"]>(r.i18n, {}) })));
  });
}
