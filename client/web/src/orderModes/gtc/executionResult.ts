/** [changmen 扩展] 执行结果与场馆订单类型分开；不以受理成功推断成交。 */
export interface ExecutionLegFact {
  provider: string;
  orderType: "FOK" | "GTC" | "venue-default";
  orderId: string | null;
  submission: "not_attempted" | "in_flight" | "accepted" | "rejected" | "unknown";
  fill: "none" | "partial" | "full" | "unknown";
  matchedShares?: string;
  remainingShares?: string | null;
}

export interface GtcExecutionResult {
  executionKind: "pm-gtc-v1";
  executionId: string;
  source: "arb" | "manual";
  observationOutcome: "gtc_orchestration_completed";
  pm: ExecutionLegFact;
  other: ExecutionLegFact | null;
  groupComplete: boolean;
  responsibility: "manual" | "complete" | "none";
  message: string;
  errorMessage: string;
  traceStatus: "success" | "partial" | "fail";
  failed: boolean;
  skippedLeg?: "A" | "B";
}

/** [changmen 扩展] 执行异常仍携带已持久化的收尾事实；展示清理不触发重发。 */
export class ExecutionError extends Error {
  constructor(public readonly result: GtcExecutionResult, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
