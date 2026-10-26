import { getActivePinia } from "pinia";
import { useUserStore } from "@/stores/userStore";

/** [changmen 扩展] 手动订单模式仅作用于本次下单，不解释历史订单。 */
export interface ExecutionSelection {
  readonly source: "manual";
  readonly orderMode: "FOK" | "GTC";
}

export function captureArbExecutionSelection(): { readonly executionMode?: "lowOddsSingle" } {
  const user = getActivePinia() ? useUserStore() : undefined;
  return Object.freeze({
    ...(user?.extensionPrefs.arbExecutionMode === "lowOddsSingle" ? { executionMode: "lowOddsSingle" as const } : {}),
  });
}

export function captureManualExecutionSelection(mode: unknown): ExecutionSelection {
  return Object.freeze({ source: "manual", orderMode: mode === "GTC" ? "GTC" : "FOK" });
}
