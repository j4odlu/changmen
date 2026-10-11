import type { OrderRow } from "@/types/order";
import { computeOrderGroupProfit, isLinkedArbOrderGroup, orderLinkLegend } from "@/shared/orderLink";

export function normalizeOrderStatus(raw: string): OrderRow["Status"] {
  const s = String(raw || "None");
  if (s === "win" || s === "Win")
    return "Win";
  if (s === "lose" || s === "Lose")
    return "Lose";
  if (s === "reject" || s === "Reject")
    return "Reject";
  if (s === "return" || s === "Return")
    return "Return";
  if (s === "pending" || s === "Pending")
    return "Pending";
  if (s === "none" || s === "None")
    return "None";
  return s;
}

export function orderStatusClass(status: string | undefined): OrderRow["Status"] {
  return normalizeOrderStatus(String(status || "None"));
}

export function orderLegendModifier(rows: OrderRow[]): "default" | "success" | "fail" {
  const total = computeOrderGroupProfit(rows);
  if (total === 0)
    return "default";
  return total > 0 ? "success" : "fail";
}

export function orderLegendText(rows: OrderRow[]) {
  // [changmen 扩展] 展示原单成本未知时，不能按零成本预估整组盈亏。
  if (rows.some(row => row.DisplayOnly && row.BetMoney == null))
    return "盈亏待核实";
  return orderLinkLegend(rows);
}

export function isArbGroup(rows: OrderRow[]) {
  return isLinkedArbOrderGroup(rows);
}
