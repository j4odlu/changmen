import type { RayNativeOrderDisplayStatus } from "@changmen/venue-browser/adapter/ray/bet";
import type { RayMonitoringState } from "@/runtime/orderMonitoring/rayState";
import type { OrderRow } from "@/types/order";
import type { RayLinkMonitorModel } from "./rayLinkMonitor";

const terminal = (status: unknown) => ["reject", "return", "win", "lose", "lost"].includes(String(status ?? "").toLowerCase());
const statusClass = (status: unknown) => {
  const text = String(status ?? "").toLowerCase().replace("lost", "lose");
  return text[0]!.toUpperCase() + text.slice(1);
};

/** [changmen 扩展] H5 状态仅作 UI 投影；不写回订单、监控、拒单检测或补单队列。 */
export function resolveRayOrderDisplayStatus(row: OrderRow, native?: RayNativeOrderDisplayStatus, monitoring?: RayMonitoringState): string | undefined {
  if (row.Type !== "RAY") return undefined;
  // 已有赛果优先，避免旧快照覆盖结算；H5 则负责区分旧业务映射同为 Reject 的拒单/退回。
  if ([row.Status, monitoring?.status].some(status => ["win", "lose", "lost"].includes(String(status ?? "").toLowerCase())))
    return statusClass([row.Status, monitoring?.status].find(status => ["win", "lose", "lost"].includes(String(status ?? "").toLowerCase())));
  if (native === "Rejected") return "Reject";
  if (native === "Returned") return "Return";
  if (terminal(row.Status)) return statusClass(row.Status);
  if (terminal(monitoring?.status)) return statusClass(monitoring!.status);
  if (native === "Settled") return "RaySettled";
  if (native === "Pending") return "RayPending";
  if (native === "Open") return "None";
  // 本地确认过程沿用“确认中”；只有原站字段判定为 Pending 才显示“待确认”。
  if (String(monitoring?.status).toLowerCase() === "pending"
    || ["pending", "rayconfirming"].includes(String(row.Status).toLowerCase())) return "RayConfirming";
  return undefined;
}

/** 仅替换同一原单的场馆状态文字，保留监控阶段及全部业务动作描述。 */
export function projectRayLinkMonitorDisplay(model: RayLinkMonitorModel, row?: OrderRow, display?: string): RayLinkMonitorModel {
  const labels: Record<string, string> = { RayPending: "待确认", None: "待结算", Reject: "拒单", Return: "退回", RaySettled: "已结算", Win: "赢", Lose: "输" };
  const canProject = display && (!["RayPending", "None"].includes(display) || ["待结算", "确认中"].includes(model.venueStatus));
  if (row && model.orderId === String(row.OrderID ?? "") && display && labels[display] && canProject)
    return { ...model, venueStatus: labels[display] };
  return model;
}
