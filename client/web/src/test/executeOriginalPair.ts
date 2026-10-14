/** [changmen 扩展] 可控已预检样例执行公共 place/settle，用于原截止与单次发送回归。 */
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import type { GtcExecutionResult } from "@/orderModes/gtc/executionResult";
import { ExecutionError } from "@/orderModes/gtc/executionResult";
import { placeArbLegs } from "@/stores/betting/autoBet/phases/placeArbLegs";
import { settleBothArbLegs } from "@/stores/betting/autoBet/phases/settleBothArbLegs";

export async function executeGtc(params: ArbBetAttemptParams, checked: ArbBetChecked): Promise<GtcExecutionResult> {
  checked.pmOrderMode = "GTC";
  try {
    const placed = await placeArbLegs(params, checked);
    await settleBothArbLegs(params, placed);
    await placed.originalExecution!.close();
    return placed.originalExecution!.summary() as GtcExecutionResult;
  }
  catch (error) {
    if (!params.originalExecution) throw error;
    await params.originalExecution.close();
    throw new ExecutionError(params.originalExecution.summary() as GtcExecutionResult, error);
  }
}
