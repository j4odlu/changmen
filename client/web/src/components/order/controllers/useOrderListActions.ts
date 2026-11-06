import type { OrderRow } from "@/types/order";
import { ElMessageBox } from "element-plus";
import { canManualSellPmBuy, confirmAndSellPmBuyOrder, isPmManualSellClosing, isPmManualSellInFlight } from "@/stores/account/pmManualSell";
import { canManualSellPfBuy, confirmAndSellPfBuyOrder, isPfManualSellInFlight } from "@/stores/account/pfManualSell";
import { isPfOrderListRow, resolvePfOrderListStatusClass } from "@/shared/pfOrderDisplay";
import { resolvePmOrderListStatusClass } from "@/shared/pmOrderDisplay";
import { makeupBetIdFromPendingRow } from "@/shared/orderLink";

/** UI actions delegate to the existing trading services and owner-side makeup cancellation. */
export function useOrderListActions(props: Readonly<{ allowPmSell: boolean; allowPfSell: boolean }>,
  cancelMakeup: (betId: number) => void) {
  function statusClass(row: OrderRow): string {
    if (isPmManualSellClosing(row.OrderID))
      return "PmClosing";
    if (isPfOrderListRow(row))
      return resolvePfOrderListStatusClass(row);
    return resolvePmOrderListStatusClass(row);
  }

  function showPmSellButton(row: OrderRow): boolean {
    return props.allowPmSell && !row.DisplayOnly && canManualSellPmBuy(row);
  }

  function showPfSellButton(row: OrderRow): boolean {
    return props.allowPfSell && canManualSellPfBuy(row);
  }

  async function onPmSell(row: OrderRow) {
    if (row.DisplayOnly)
      return;
    await confirmAndSellPmBuyOrder(row);
  }

  async function onPfSell(row: OrderRow) {
    await confirmAndSellPfBuyOrder(row);
  }

  function onCancelMakeup(row: OrderRow) {
    const betId = makeupBetIdFromPendingRow(row);
    if (!betId)
      return;
    ElMessageBox.confirm("确认要取消补单吗？", "补单取消", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    })
      .then(() => {
        cancelMakeup(betId);
      })
      .catch(() => {});
  }


  return { statusClass, showPmSellButton, showPfSellButton, onPmSell, onPfSell, onCancelMakeup, isPmManualSellInFlight, isPfManualSellInFlight };
}
