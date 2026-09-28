import type { ClientMatchDto } from "@/types/esport";

function settledRows(result: PromiseSettledResult<ClientMatchDto[]>): ClientMatchDto[] {
  return result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];
}

/** 场馆列表只并列，不合场、不 overlay；POD 插件分别完成身份与盘口匹配。 */
export async function collectIndependentFootballVenueRows(
  ...venuePromises: Promise<ClientMatchDto[]>[]
): Promise<ClientMatchDto[]> {
  const settled = await Promise.allSettled(venuePromises);
  const rows = settled.flatMap(settledRows);
  rows.sort((a, b) => (
    (Number(a.StartTime) || 0) - (Number(b.StartTime) || 0)
    || (Number(a.ID) || 0) - (Number(b.ID) || 0)
  ));
  if (rows.length)
    return rows;
  const rejected = settled.find(result => result.status === "rejected");
  const reason = rejected?.status === "rejected" ? rejected.reason : null;
  if (reason)
    throw reason instanceof Error ? reason : new Error(String(reason));
  return [];
}
