import { getActivePinia } from "pinia";
import { useUserStore } from "@/stores/userStore";

/** [changmen 扩展] 手动订单模式仅作用于本次下单，不解释历史订单。 */
export interface ExecutionSelection {
  readonly source: "manual";
  readonly orderMode: "FOK" | "GTC";
}

export function captureArbExecutionSelection(): { readonly executionMode?: "lowOddsSingle" | "obSingle" } {
  const user = getActivePinia() ? useUserStore() : undefined;
  const mode = user?.extensionPrefs.arbExecutionMode;
  return Object.freeze({
    ...(mode === "lowOddsSingle" || mode === "obSingle" ? { executionMode: mode } : {}),
  });
}

export function captureManualExecutionSelection(mode: unknown): ExecutionSelection {
  return Object.freeze({ source: "manual", orderMode: mode === "GTC" ? "GTC" : "FOK" });
}
