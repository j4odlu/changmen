import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { ExecutionLegFact, GtcExecutionResult } from "@/orderModes/gtc/executionResult";
import { gtcCanFinishWithoutOrders, gtcPmNeverSubmitted, gtcStateLabel, gtcUnits } from "@changmen/shared/pm_gtc";

/** [changmen 扩展] 只有执行器把场馆事实投影成结果，编排不解析官方回执。 */
export function gtcExecutionResult(row: GtcExecution): GtcExecutionResult {
  const neverSubmitted = gtcPmNeverSubmitted(row);
  const noOrders = gtcCanFinishWithoutOrders(row);
  const manual = row.plan.source === "manual";
  const submission: ExecutionLegFact["submission"] = neverSubmitted
    ? "not_attempted"
    : row.submit === "prepared" || row.submit === "dispatching"
      ? "in_flight"
      : row.submit === "not_attempted" ? "not_attempted" : row.submit;
  const fill: ExecutionLegFact["fill"] = !row.complete || row.error
    ? "unknown"
    : gtcUnits(row.matched) === 0n
      ? "none"
      : gtcUnits(row.matched) >= gtcUnits(row.plan.shares) ? "full" : "partial";
  const otherSubmission: ExecutionLegFact["submission"] = row.other.state === "authorized"
    ? "in_flight"
    : row.other.state === "pending" || row.other.state === "filled" ? "accepted" : row.other.state;
  const message = manual
    ? `PM 手动 GTC：${gtcStateLabel(row)}；成交 ${row.matched}/${row.plan.shares} 份；挂单 ${row.open ?? "待核实"} 份`
    : noOrders
      ? `${row.other.state === "rejected" ? `${row.plan.otherProvider} 下单失败：${row.other.message || "场馆未受理"}；` : ""}PM 未提交；本次执行已结束，无订单或挂单`
      : `${gtcStateLabel(row)}；${row.groupComplete ? "本组已完成" : "本组转人工处理，后续成交仅更新原单"}`;
  return {
    executionKind: "pm-gtc-v1",
    executionId: row.id,
    source: manual ? "manual" : "arb",
    observationOutcome: "gtc_orchestration_completed",
    pm: { provider: "Polymarket", orderType: "GTC", orderId: row.orderId, submission, fill, matchedShares: row.matched, remainingShares: row.open },
    other: manual ? null : { provider: row.plan.otherProvider, orderType: "venue-default", orderId: row.other.orderId, submission: otherSubmission, fill: row.other.state === "filled" ? "full" : row.other.state === "not_attempted" || row.other.state === "rejected" ? "none" : "unknown" },
    groupComplete: row.groupComplete,
    responsibility: row.groupComplete ? "complete" : row.released ? "none" : "manual",
    message,
    errorMessage: row.error,
    traceStatus: row.groupComplete ? "success" : row.submit === "accepted" ? "partial" : "fail",
    failed: noOrders || (row.submit === "rejected" && row.other.state !== "filled"),
    ...(neverSubmitted ? { skippedLeg: row.plan.originalPmLeg } : {}),
  };
}
