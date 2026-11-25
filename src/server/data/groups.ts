import "server-only";
import { io } from "next/cache";
import { groupName, type LottoGroupInfo } from "@/domain/lotto-groups";
import { getI18n } from "@/i18n/rsc";
import { listGroups } from "@/server/services/lotto-groups";

/** A lottery group with its name in the request's language. */
export type GroupView = LottoGroupInfo & { label: string };

export async function getGroups(): Promise<GroupView[]> {
  const { lang, t } = await getI18n();
  await io();
  return (await listGroups()).map((g) => ({ ...g, label: groupName(g, lang, t.lotto.groups) }));
}
