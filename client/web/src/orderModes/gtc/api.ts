import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { post, unwrap } from "@/api/client";
import { gtcFinancialOrder } from "./financialOrder";

export async function listGtc(betRowId?: number): Promise<GtcExecution[]> { return unwrap(await post<GtcExecution[]>("Pm_GtcList", betRowId == null ? undefined : { betRowId })); }
export async function createGtc(id: string, maker: string, plan: GtcPlan): Promise<GtcExecution> {
  return unwrap(await post<GtcExecution>("Pm_GtcCreate", { id, maker, plan }));
}
export async function commandGtc(row: GtcExecution, command: GtcCommand): Promise<GtcExecution> {
  const financialRow = command.kind === "facts" ? mergeGtcFacts(JSON.parse(JSON.stringify(row)), command.facts) : row;
  const financialOrder = gtcFinancialOrder(financialRow);
  return unwrap(await post<GtcExecution>("Pm_GtcCommand", { id: row.id, revision: row.revision, command: { ...command, financialOrder } }));
}
