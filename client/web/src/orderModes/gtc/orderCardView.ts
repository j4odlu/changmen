import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { gtcDecimal, gtcPmNeverSubmitted, gtcUnits } from "@changmen/shared/pm_gtc";
import { resolveGtcFillFee } from "@changmen/venue-adapter/polymarket/gtc";
import { gtcOriginalOrderActions } from "@/orderModes/gtc/executionIdentity";

/** [changmen 扩展] 只整理 GTC 附加信息，普通订单字段由 OrderList 显示。 */
export function gtcOrderCardView(row: GtcExecution) {
  const unsubmitted = gtcPmNeverSubmitted(row);
  const matched = gtcUnits(row.matched);
  const total = gtcUnits(row.plan.shares);
  const fills = Object.values(row.fills).filter(fill => fill.status !== "FAILED");
  const detailMatched = fills.reduce((quantity, fill) => quantity + gtcUnits(fill.shares), 0n);
  const quantitiesAgree = Boolean(row.order) && gtcUnits(row.order!.matched) === matched && detailMatched === matched;
  const fees = fills.map(fill => fill.fee == null ? resolveGtcFillFee(row.plan.feeProof, fill.role, Number(fill.shares), Number(fill.price)) : Number(fill.fee));
  const fee = quantitiesAgree && fees.every(value => value != null)
    ? gtcDecimal(fees.reduce<bigint>((sum, value) => sum + gtcUnits(value!.toFixed(6)), 0n))
    : null;
  const confirmedFull = matched === total && matched > 0n && quantitiesAgree && fills.every(fill => fill.status === "CONFIRMED");
  let state = "提交待核实";
  let tone = "default";
  if (unsubmitted) {
    state = "未提交";
  }
  else if (row.submit === "rejected") {
    state = "明确拒单"; tone = "fail";
  }
  else if (matched > 0n && quantitiesAgree) {
    state = matched === total ? "全部成交" : row.terminal ? "部分成交 · 余量已终止" : "部分成交";
    tone = "success";
  }
  else if (matched > 0n) {
    state = "成交待核实";
  }
  else if (row.submit === "accepted") {
    state = row.terminal ? "余量已终止" : row.order?.status === "DELAYED" ? "待撮合" : row.open != null ? "挂单中" : "已受理";
  }
  else if (row.submit === "prepared") {
    state = "准备中";
  }
  const verification: string[] = [];
  if (!unsubmitted && row.submit !== "rejected") {
    if (fee == null)
      verification.push("费用待核实");
    if (matched > 0n && fills.some(fill => fill.status !== "CONFIRMED"))
      verification.push("成交待确认");
    if (!quantitiesAgree || (!row.complete && !row.error))
      verification.push("成交明细待核实");
  }
  const actions = gtcOriginalOrderActions(row);
  return {
    state,
    tone,
    unsubmitted,
    verification,
    quantitiesAgree,
    principal: quantitiesAgree ? row.principal : null,
    fee,
    detailError: row.error === "成交费用待核实" || (confirmedFull && /GTC (?:原单尚未查到|本次原单查询未返回记录)/.test(row.error)) ? "" : row.error,
    queryDiagnostic: confirmedFull && /GTC (?:原单尚未查到|本次原单查询未返回记录)/.test(row.error) ? row.error : "",
    showCancel: actions.showCancel && !row.terminal && (row.open == null || gtcUnits(row.open) > 0n),
    canCancel: actions.canCancel,
  };
}
