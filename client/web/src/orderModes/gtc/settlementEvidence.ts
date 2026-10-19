/** [changmen 扩展] 只保留已保存原单的结算证据，查询停止不随侧栏日期/筛选改变。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { OrderRow } from "@/types/order";

function isFinal(row: OrderRow) {
  return row.PmSide !== "sell"
    && ["win", "lose", "lost", "return", "reject"].includes(String(row.Status).toLowerCase());
}
const key = (row: OrderRow) => JSON.stringify([row.PmGtcExecutionId, row.PlayerID, row.Type, String(row.OrderID).toLowerCase()]);

export function createGtcSettlementEvidence() {
  const settled = new Map<string, OrderRow>();
  return {
    rows(current: OrderRow[]): OrderRow[] {
      for (const row of current) {
        if (!row.PmGtcExecutionId || row.PmSide === "sell")
          continue;
        if (isFinal(row))
          settled.set(key(row), row);
      }
      return [...settled.values(), ...current];
    },
    rememberOther(execution: GtcExecution, original: VenueOrder): void {
      const row: OrderRow = { PmGtcExecutionId: execution.id, PlayerID: execution.plan.otherPlayerId, Type: execution.plan.otherProvider, OrderID: original.orderId, Status: original.status };
      if (isFinal(row))
        settled.set(key(row), row);
    },
    reset(): void { settled.clear(); },
  };
}
