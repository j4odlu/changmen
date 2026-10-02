import type { ObservationContext } from "@changmen/shared/order_observation";
import type { ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { createObservationContext, observeOrder } from "./orderObservation";
import { observationFailureEvidence } from "./orderObservationEvidence";

/** [changmen 扩展] 编排生命周期独立于腿/补单生命周期，完成不代表双腿成交。 */
export function beginExecutionObservation(ready: ArbBetReady): ObservationContext | undefined {
  try {
    const seed = createObservationContext();
    if (!seed)
      return undefined;
    const context: ObservationContext = { ownerUserId: seed.ownerUserId, executionId: crypto.randomUUID(), sequence: 0 };
    for (const leg of [ready.legA, ready.legB]) {
      if (!leg)
        continue;
      try {
        leg.observation ??= createObservationContext(context);
        if (leg.observation)
          leg.observation.executionId = context.executionId;
      }
      catch { /* 不可写腿不阻断其他腿及整轮记录 */ }
    }
    observeOrder(context, ready.linkId, "execution_started", { source: "orchestration", phase: "check" });
    return context;
  }
  catch { return undefined; }
}

export function finishExecutionObservation(context: ObservationContext | undefined, linkId: number | undefined, outcome: string, phase: string, message?: unknown): void {
  try {
    observeOrder(context, linkId, "execution_finished", { source: "orchestration", outcome, phase, ...(outcome === "exception" ? observationFailureEvidence(message) : {}) });
  }
  catch { /* 旁路生命周期不得改变业务收尾 */ }
}
