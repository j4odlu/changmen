import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { gtcCanCancel, gtcPmNeverSubmitted } from "@changmen/shared/pm_gtc";

/** [changmen 扩展] 原单类型与整组来源不同；不读取配置，也不按 Link 猜测。 */
export interface OrderExecutionIdentity {
  executionKind: "fok" | "pm-gtc-v1";
  executionId: string | null;
  provider: string;
  side: "buy" | "sell";
  orderType: "FOK" | "GTC" | "venue-default" | "unknown";
}

export function orderExecutionIdentity(row: OrderRow): OrderExecutionIdentity {
  const executionId = row.PmGtcExecutionId || null;
  const provider = String(row.Type ?? "");
  const side = row.PmSide === "sell" || row.PfSide === "sell" ? "sell" : "buy";
  return {
    executionKind: executionId ? "pm-gtc-v1" : "fok",
    executionId,
    provider,
    side,
    orderType: provider !== "Polymarket"
      ? "venue-default"
      : side === "sell"
        ? "FOK"
        : executionId ? "GTC" : row.PmOrigin === "external" ? "unknown" : "FOK",
  };
}

export function gtcOriginalOrderActions(row: GtcExecution) {
  const identity = orderExecutionIdentity({ Type: "Polymarket", PmSide: "buy", PmGtcExecutionId: row.id });
  return { identity, ...orderExecutionActions(identity, { submitted: !gtcPmNeverSubmitted(row), canCancel: gtcCanCancel(row) }) };
}

export function orderExecutionActions(identity: OrderExecutionIdentity, state: { submitted: boolean; canCancel: boolean }) {
  const showCancel = identity.provider === "Polymarket" && identity.orderType === "GTC"
    && identity.side === "buy" && state.submitted;
  return { showCancel, canCancel: showCancel && state.canCancel };
}
