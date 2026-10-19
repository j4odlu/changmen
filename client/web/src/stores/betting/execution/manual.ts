import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ExecutionSelection } from "./selection";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ManualExecutionContext } from "@/orderModes/fok/manual";
import { executeManualFok } from "@/orderModes/fok/manual";

/** [changmen 扩展] Only selects a module; neither path can fall through to the other. */
export async function executeManualOrder(account: PlatformAccount, option: BetOption, selection: ExecutionSelection, context: ManualExecutionContext): Promise<void> {
  if (selection.source === "manual" && option.type === "Polymarket" && selection.orderMode === "GTC") {
    const { runManualGtc } = await import("@/orderModes/gtc/manualEntry");
    return runManualGtc(account, option, context);
  }
  return executeManualFok(account, option, context);
}
