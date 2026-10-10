import type { BetResult } from "@changmen/client-core/models/betResult";
import type { BetNotice } from "@/shared/betNotification";
import type { GtcExecutionResult } from "./executionResult";

export function gtcPmNotice(result: GtcExecutionResult): BetNotice {
  const type = result.pm.submission === "rejected" ? "error"
    : result.pm.submission === "accepted" && result.pm.fill === "full" ? "success" : "warning";
  return { type, message: `${result.message}${result.errorMessage ? `；${result.errorMessage}` : ""}` };
}

export function gtcOtherNotice(result: BetResult): BetNotice {
  const unknown = result.pmSubmitUnknown || (!result.success && !result.response);
  return {
    type: unknown || result.pending ? "warning" : result.success ? "success" : "error",
    message: unknown ? `${result.message || "提交结果待核实"}；请勿重复下单` : result.message || (result.pending ? "成交待确认" : result.success ? "下单成功" : "下单失败"),
  };
}
