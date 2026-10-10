import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import type { BetProgressStage } from "@/shared/activeBetRunStages";
import type { ProgressTone } from "@/shared/activeBetRunPresentation";
import { gtcPmNeverSubmitted, gtcStateLabel, gtcUnits } from "@changmen/shared/pm_gtc";
import { gtcExecutionResult } from "./result";

/** [changmen 扩展] 只读投影原执行；不按当前配置、场馆或近似时间借用另一单。 */
export function findRealtimeGtc(run: ActiveBetRun, owner: string, records: readonly GtcExecution[]) {
  if (!owner || !run.linkId) return undefined;
  const matches = records.filter(row => row.owner === owner && row.plan.source !== "manual"
    && row.plan.linkId === run.linkId && row.plan.betRowId === run.betId && row.plan.matchId === run.matchId
    && run.legs.length === 2 && run.legs.every(leg => leg.side === row.plan.originalPmLeg
      ? leg.platform === "Polymarket" && leg.target === row.plan.target
      : leg.platform === row.plan.otherProvider && leg.target === row.plan.otherTarget));
  return matches.length === 1 ? matches[0] : undefined;
}

export function gtcOtherProgressLabel(row: GtcExecution): string {
  return { not_attempted: "未提交", authorized: "提交处理中", accepted: "已受理 · 待确认",
    pending: "原单待确认", filled: "原单已确认", rejected: "下单失败 / 拒单", unknown: "提交结果待核实" }[row.other.state];
}

function originalOrders(row: GtcExecution, pm: boolean, orders: readonly OrderRow[]) {
  const orderId = pm ? row.orderId : row.other.orderId;
  return orders.filter(order => Boolean(orderId) && String(order.OrderID).toLowerCase() === orderId!.toLowerCase()
    && order.Link === row.plan.linkId && order.Type === (pm ? "Polymarket" : row.plan.otherProvider)
    && order.PlayerID === (pm ? row.plan.playerId : row.plan.otherPlayerId)
    && order.PmGtcExecutionId === row.id && order.PmSide !== "sell" && order.PfSide !== "sell");
}

/** [changmen 扩展] 当前原单拒单/退回不能被较旧的 GTC 编排快照覆盖；只修订展示。 */
function currentOtherRejection(row: GtcExecution, orders: readonly OrderRow[]) {
  const records = originalOrders(row, false, orders);
  if (records.length !== 1) return undefined;
  const status = String(records[0]!.Status).toLowerCase();
  return status === "reject" ? "原单拒单" : status === "return" ? "原单退回" : undefined;
}

export function realtimeGtcMessage(row: GtcExecution, orders: readonly OrderRow[]) {
  const rejection = currentOtherRejection(row, orders);
  return rejection ? `PM ${gtcStateLabel(row)}；${row.plan.otherProvider} ${rejection}；本组需重新核查`
    : gtcExecutionResult(row).message;
}

/** [changmen 扩展] GTC 持久化事实补充展示，原始观察时间线不改写、不伪造缺失回执。 */
export function realtimeGtcLeg(row: GtcExecution, leg: ActiveBetLeg, orders: readonly OrderRow[]) {
  const pm = leg.side === row.plan.originalPmLeg;
  const provider = pm ? "Polymarket" : row.plan.otherProvider;
  const accountId = pm ? row.plan.playerId : row.plan.otherPlayerId;
  const orderId = (pm ? row.orderId : row.other.orderId) || undefined;
  const records = originalOrders(row, pm, orders);
  const bound = records.length === 1;
  const neverSubmitted = pm ? gtcPmNeverSubmitted(row) : row.other.state === "not_attempted";
  const submitted = pm ? row.submit === "accepted" : ["accepted", "pending", "filled"].includes(row.other.state);
  const recordRejection = !pm && currentOtherRejection(row, orders);
  const rejected = pm ? !neverSubmitted && row.submit === "rejected" : row.other.state === "rejected" || Boolean(recordRejection);
  const unknown = pm ? row.submit === "unknown" : row.other.state === "unknown";
  const label = pm ? gtcStateLabel(row).replace(/^下单成功 · /, "GTC · ") : recordRejection || gtcOtherProgressLabel(row);
  const tone: ProgressTone = rejected ? "danger" : unknown || pm && Boolean(row.error) ? "warning"
    : pm ? neverSubmitted ? "neutral" : row.complete && gtcUnits(row.matched) >= gtcUnits(row.plan.shares) ? "success"
      : row.terminal && row.complete ? "warning" : "pending"
      : row.other.state === "filled" ? "success" : neverSubmitted ? "neutral" : "pending";
  const basis = pm
    ? `GTC 原单核对：成交 ${row.matched} / ${row.plan.shares} 份；挂单 ${row.open ?? "待核实"} 份${row.error ? `；${row.error}` : ""}`
    : recordRejection ? `当前已落库原单状态：${recordRejection}（状态更新时间未提供）`
      : `GTC 对侧原单：${gtcOtherProgressLabel(row)}${row.other.message ? `；${row.other.message}` : ""}`;
  // observedAt 是 PM 核对时间；不得用它伪造对侧确认或落库时间。
  const at = pm && row.observedAt > 0 ? row.observedAt : undefined;
  const stage = (id: string, name: string, value: string, color: ProgressTone, detail?: string, time?: number): BetProgressStage =>
    ({ id, stage: name, label: value, tone: color, detail, at: time });
  const stages = [
    stage("submission", "提交下注", neverSubmitted ? "未提交" : submitted ? pm ? "GTC 原单已受理" : "接口已受理"
      : rejected ? "提交返回失败" : unknown ? "提交结果未知" : "提交处理中",
    neverSubmitted ? "neutral" : submitted ? "success" : rejected ? "danger" : unknown ? "warning" : "pending",
    `依据 GTC 执行记录${orderId ? ` · 订单 ${orderId}` : ""}`),
    stage("binding", "绑定订单", bound ? "原单已落库" : neverSubmitted ? "不参与" : "等待原单落库核对", bound ? "success" : "neutral",
      bound ? `订单 ${orderId} · 账号 ${accountId}` : neverSubmitted ? undefined : "未收到匹配此 GTC 执行、账号及订单号的订单记录"),
    stage("confirmation", pm ? "GTC 成交核对" : "场馆确认 / 拒单检测", label, tone, basis, at),
    ...(provider === "RAY" ? [stage("ray_monitor", "RAY订单监控", neverSubmitted ? "不参与" : "参见订单列表监控状态", "neutral",
      neverSubmitted ? undefined : "GTC 原单确认与持续监控分别展示；此处没有独立监控登记回执")] : []),
    stage("makeup", "补单队列", "GTC 原单不自动补单", "neutral"),
    stage("result", "编排收尾", row.decision === "closed" ? "本轮编排已结束" : "编排进行中", "neutral", realtimeGtcMessage(row, orders)),
  ];
  const financial = pm ? row.financialOrder : undefined;
  return { label, tone, basis, provider, accountId, orderId, linkId: row.plan.linkId, bound, stages,
    odds: financial?.odds ?? (pm ? undefined : row.plan.otherOdds),
    amount: financial ? `${financial.pmStakeUsdc} USDC` : undefined,
    failureReason: rejected ? pm ? row.error || "PM 明确拒单" : recordRejection || row.other.message || "对侧场馆未受理或原单拒单" : undefined };
}

export function mergeRealtimeGtcStages(base: readonly BetProgressStage[], current: ReturnType<typeof realtimeGtcLeg>): BetProgressStage[] {
  const result = base.map(stage => {
    if (stage.id === "ray_monitor" && stage.proof?.events.some(event => event.source === "ray_monitor")) return stage;
    const projected = current.stages.find(value => value.id === stage.id);
    // 保留已记录的首轮提交时间与耗时；未知回执后的原单核实仍以 GTC 当前事实补充。
    const submission = stage.id === "submission" ? stage.proof?.events.find(event => event.kind === "submission_result"
      && event.linkId === current.linkId && event.provider === current.provider && event.accountId === current.accountId
      && (!event.orderId || event.orderId.toLowerCase() === current.orderId?.toLowerCase())) : undefined;
    if (projected && submission?.outcome === "accepted") return { ...stage,
      label: current.provider === "Polymarket" ? "GTC 原单已受理" : stage.label };
    return projected || stage;
  });
  if (!result.some(stage => stage.id === "confirmation")) {
    const confirmation = current.stages.find(stage => stage.id === "confirmation")!;
    result.splice(result.findIndex(stage => stage.id === "binding") + 1, 0, confirmation);
  }
  return result;
}
