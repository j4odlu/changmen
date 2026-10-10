import { getActivePinia } from "pinia";
import { useUserStore } from "@/stores/userStore";

/** [changmen 扩展] 模式在准备前冻结；只决定本次新执行，不解释历史订单。 */
export interface ExecutionSelection {
  readonly source: "arb" | "manual";
  readonly orderMode: "FOK" | "GTC";
}

export function captureArbExecutionSelection(): ExecutionSelection {
  const user = getActivePinia() ? useUserStore() : undefined;
  const active = user?.extensionPrefs.pmArbOrderMode === "GTC"
    && user.extensionPrefs.pmGtcV1Activation === `1:${user.userId}`;
  return Object.freeze({ source: "arb", orderMode: active ? "GTC" : "FOK" });
}

export function captureManualExecutionSelection(mode: unknown): ExecutionSelection {
  return Object.freeze({ source: "manual", orderMode: mode === "GTC" ? "GTC" : "FOK" });
}
