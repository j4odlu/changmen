import type { GtcExecutionResult } from "@/orderModes/gtc/executionResult";
import type { ArbBetAttemptParams } from "@/stores/betting/autoBet/phases/types";
import { scheduleActiveBetRunRemoval, syncActiveBetFail, syncActiveBetLeg, syncActiveBetPhase } from "@/stores/betting/activeBetRunSync";

/** [changmen 扩展] 只消费执行结果；FOK 原收尾已经完成，不重复任何副作用。 */
export function presentArbExecution(params: ArbBetAttemptParams, result: GtcExecutionResult): void {
  if (result.skippedLeg)
    syncActiveBetLeg(params.bet.id, result.skippedLeg, "skipped", "PM 未提交");
  params.setMessage(result.message);
  params.trace?.finish(result.traceStatus, result.message);
  if (result.failed)
    syncActiveBetFail(params.bet.id, result.message);
  else
    syncActiveBetPhase(params.bet.id, "syncing", result.message);
  scheduleActiveBetRunRemoval(params.bet.id);
}
