import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { gtcDecimal, gtcUnits } from "@changmen/shared/pm_gtc";
import type { GtcSyncIssue } from "./syncStatus";
import { formatPolymarketApiDecimal } from "@/shared/pmOrderDisplay";
import { gtcOrderCardView } from "./orderCardView";
import { gtcPmReconciled } from "./pollingPolicy";

/** [changmen 扩展] PM 原单监控只读展示；不启动查询、不修改执行或财务事实。 */
export function pmGtcMonitorCardView(row: GtcExecution, issue?: GtcSyncIssue) {
  const order = gtcOrderCardView(row);
  const reconciled = gtcPmReconciled(row);
  const cancelPending = !row.terminal && Boolean(row.cancel && ["requested", "dispatching", "unknown", "acknowledged"].includes(row.cancel.state));
  const cancelLabel = cancelPending
    ? row.cancel?.state === "requested" || row.cancel?.state === "dispatching" ? "取消中" : "取消结果待核实"
    : "";
  const principal = Number(order.principal);
  const matched = Number(row.matched);
  const averagePrice = order.principal != null && Number.isFinite(principal) && matched > 0
    ? formatPolymarketApiDecimal(principal / matched)
    : null;
  // [changmen 扩展] 仅在原单数量与有效成交明细一致时展示角色份额，不改变动作资格。
  const fills = Object.values(row.fills).filter(fill => fill.status !== "FAILED");
  const shares = (role: "TAKER" | "MAKER") => order.quantitiesAgree
    ? gtcDecimal(fills.filter(fill => fill.role === role).reduce((sum, fill) => sum + gtcUnits(fill.shares), 0n))
    : null;
  return {
    ...order,
    averagePrice,
    reconciled,
    cancelPending,
    cancelLabel,
    takerShares: shares("TAKER"),
    makerShares: shares("MAKER"),
    monitorLabel: issue ? issue.kind === "auth" ? "同步暂停" : "监控重试中" : reconciled ? "核对完成" : "监控中",
    monitorTone: issue || order.detailError || order.verification.length ? "warning" : order.tone === "fail" ? "danger" : reconciled ? "success" : "info",
  };
}
