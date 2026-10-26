import type { GtcFacts, GtcFinancialOrder, GtcOrderPlan, GtcOrderState } from "./pm_gtc_order.ts";
import { canCancelGtcOrder, gtcOrderNeverSubmitted, gtcUnits, mergeGtcOrderFacts } from "./pm_gtc_order.ts";
export type { GtcSubmitState, GtcFeeProof, GtcFill, GtcOrderFact, GtcFacts, GtcFinancialOrder } from "./pm_gtc_order.ts";
export { gtcUnits, gtcDecimal, gtcNumber, gtcFillPrice } from "./pm_gtc_order.ts";
/** [changmen 扩展] GTC V1 独立事实与决策契约；不被 FOK adapter 消费。 */
export const PM_GTC_VERSION = 1;
export const PM_GTC_INITIAL_MS = 10_000;
export type GtcOtherState = "not_attempted" | "authorized" | "accepted" | "pending" | "filled" | "rejected" | "unknown";
/** [changmen 扩展] 旧执行存储兼容结构；新业务使用 GtcOrderPlan。 */
export interface GtcPlan extends GtcOrderPlan {
  /** [changmen 扩展] 缺省为原双腿套利；manual 是独立单腿手动订单。 */
  source?: "manual";
  playerId: number;
  otherPlayerId: number;
  originalPmLeg: "A" | "B";
  otherProvider: string;
  otherTarget: "Home" | "Away";
  otherOdds: number;
  otherStake: number;
  matchId: number;
  betRowId: number;
  linkId: number;
  otherVenueMatchId: string;
  otherVenueItemId: string;
  target: "Home" | "Away";
  match: string;
  bet: string;
  item: string;
  fx: number;
  parallel: boolean;
}
export interface GtcExecution extends GtcOrderState {
  financialOrder?: GtcFinancialOrder;
  id: string;
  owner: string;
  walletKey: string;
  maker: string;
  plan: GtcPlan;
  createdAt: number;
  revision: number;
  decision: "open" | "closed";
  deadlineAt: number;
  other: { state: GtcOtherState; orderId: string | null; submittedAt: number; message: string; notSent?: boolean };
  manual: boolean;
  released: boolean;
  releaseRevision?: number;
  groupComplete: boolean;
  counted: boolean;
}
/** [changmen 扩展] 兼容旧版把未授权 PM 腿写成 rejected 的记录；有任何订单证据就不能据此结束。 */
export const gtcPmNeverSubmitted = gtcOrderNeverSubmitted;
export function gtcCanFinishWithoutOrders(row: GtcExecution): boolean {
  return row.decision === "closed" && gtcPmNeverSubmitted(row)
    && ["not_attempted", "rejected"].includes(row.other.state) && !row.other.orderId;
}
export function gtcStateLabel(row: GtcExecution): string {
  if (row.decision === "closed" && gtcPmNeverSubmitted(row))
    return "未提交 · 本次执行已结束";
  if (row.submit === "rejected")
    return "下单失败 · 明确拒单";
  if (row.submit !== "accepted")
    return row.submit === "prepared" ? "准备中" : "提交结果待核实";
  if (row.error || !row.complete)
    return "下单成功 · 成交待核实";
  if (gtcUnits(row.matched) >= gtcUnits(row.plan.shares))
    return "下单成功 · 全部成交";
  if (row.terminal)
    return gtcUnits(row.matched) > 0n ? "下单成功 · 部分成交，余量已终止" : "已受理 · 未成交，余量已终止";
  if (gtcUnits(row.matched) > 0n)
    return "下单成功 · 部分成交挂单中";
  return row.order?.status === "DELAYED" ? "下单成功 · 待撮合" : "下单成功 · 未成交挂单中";
}
export function createGtcExecution(id: string, owner: string, walletKey: string, maker: string, plan: GtcPlan, now: number): GtcExecution {
  return { id, owner, walletKey, maker, plan, createdAt: now, revision: 0, submit: "prepared", orderId: null, decision: "open", deadlineAt: 0, pmAuthorized: false, other: { state: "not_attempted", orderId: null, submittedAt: 0, message: "" }, manual: false, released: false, cancel: null, fills: {}, order: null, matched: "0", principal: "0", fee: "0", open: null, terminal: false, complete: false, groupComplete: false, observedAt: 0, error: "", counted: false };
}
export function gtcCanAuthorizeOther(row: GtcExecution): boolean {
  if (row.plan.source === "manual")
    return false;
  if (row.manual || row.cancel || row.decision !== "open" || row.other.state !== "not_attempted" || row.other.notSent)
    return false;
  if (row.plan.parallel || row.plan.originalPmLeg === "B")
    return true;
  // [A8 可证实] 顺序首腿成功后发送第二腿；[changmen 扩展] GTC 保留一次性授权与主动关闭检查。
  return row.pmAuthorized && row.submit === "accepted";
}
export const gtcCanCancel = canCancelGtcOrder;
export function gtcCanRelease(row: GtcExecution): boolean {
  return row.decision === "closed" && row.terminal && row.complete && !row.error
    && Object.values(row.fills).every(fill => ["CONFIRMED", "FAILED"].includes(fill.status))
    && ["not_attempted", "filled", "rejected"].includes(row.other.state);
}

function canFinishManualGtc(row: GtcExecution): boolean {
  return row.plan.source === "manual" && row.decision === "closed"
    && (gtcCanRelease(row) || (row.submit === "rejected" && row.terminal && row.complete
      && gtcUnits(row.matched) === 0n && !Object.keys(row.fills).length));
}

/** [changmen 扩展] 单笔事实由订单核心归并，旧双腿协调仅在兼容入口处理。 */
export function mergeGtcFacts(previous: GtcExecution, facts: GtcFacts): GtcExecution {
  const row = mergeGtcOrderFacts(previous, facts);
  row.groupComplete = !row.manual && row.complete && gtcUnits(row.matched) === gtcUnits(row.plan.shares) && row.other.state === "filled";
  if (row.released && (!row.complete || row.error || !row.terminal)) {
    row.released = false; row.manual = true;
  }
  if (!row.manual && row.groupComplete && gtcCanRelease(row))
    row.released = true;
  if (canFinishManualGtc(row))
    row.released = true;
  return row;
}

type GtcCommandBody
  = | { kind: "authorize_pm" | "authorize_other" | "close" | "resume" | "counted" }
    | { kind: "ack"; state: "accepted" | "rejected" | "unknown"; orderId?: string; message?: string }
    | { kind: "other"; state: GtcOtherState; orderId?: string; message?: string }
    | { kind: "not_sent"; leg: "PM" | "OTHER"; message: string }
    | { kind: "facts"; facts: GtcFacts }
    | { kind: "cancel"; commandId: string }
    | { kind: "cancel_result"; commandId: string; state: "unknown" | "failed" | "acknowledged"; message: string };

export type GtcCommand = GtcCommandBody & { financialOrder?: GtcFinancialOrder };

/** 所有一次性提交授权在数据库行锁内调用；客户端重放只能读，不能再获授权。 */
export function applyGtcCommand(previous: GtcExecution, command: GtcCommand, now: number): GtcExecution {
  let row = structuredClone(previous);
  switch (command.kind) {
    case "authorize_pm":
      if (row.pmAuthorized || row.submitNotSent || row.decision !== "open" || row.manual)
        throw new Error("GTC 原单已授权或已结束；禁止重发");
      row.pmAuthorized = true; row.submit = "dispatching"; row.deadlineAt = now + PM_GTC_INITIAL_MS; break;
    case "authorize_other":
      if (!gtcCanAuthorizeOther(row))
        throw new Error("GTC 第二腿不可再次提交");
      row.other.state = "authorized"; row.other.submittedAt = now; break;
    case "not_sent":
      if (command.leg === "PM") {
        if (!["prepared", "not_attempted", "dispatching"].includes(row.submit)
          || row.orderId || row.order || row.cancel || Object.keys(row.fills).length
          || gtcUnits(row.matched) !== 0n || gtcUnits(row.principal) !== 0n)
          throw new Error("GTC 已有提交或订单证据，不能标为未发送");
        row.submitNotSent = true; row.submit = "not_attempted"; row.error = command.message;
        row.terminal = true; row.complete = true; row.open = "0";
      }
      else if (command.leg === "OTHER" && row.plan.source !== "manual") {
        if (!["not_attempted", "authorized"].includes(row.other.state) || row.other.orderId)
          throw new Error("GTC 对侧已有提交证据，不能标为未发送");
        row.other = { ...row.other, state: "not_attempted", notSent: true, message: command.message };
      }
      else throw new Error("GTC 未发送腿无效");
      break;
    case "ack":
      if (!["accepted", "rejected", "unknown"].includes(command.state))
        throw new Error("GTC 回执状态无效");
      if (!row.pmAuthorized)
        throw new Error("GTC 原单未授权");
      if (command.state === "accepted") {
        if (!command.orderId || command.orderId.toLowerCase() !== row.plan.orderHash.toLowerCase())
          throw new Error("GTC 回执订单身份不一致");
        row.orderId = command.orderId; row.submit = "accepted";
      }
      else if (row.submit !== "accepted") {
        row.submit = command.state;
      }
      row.error = command.message ?? "";
      if (row.submit === "rejected") { row.terminal = true; row.complete = true; row.open = "0"; }
      break;
    case "other":
      if (row.plan.source === "manual")
        throw new Error("手动 GTC 不允许提交或更新第二腿");
      if (!["accepted", "pending", "filled", "rejected", "unknown"].includes(command.state))
        throw new Error("GTC 第二腿状态无效，不能重置一次性授权");
      if (row.other.state === "not_attempted")
        throw new Error("第二腿未授权");
      row.other = { ...row.other, state: command.state, orderId: command.orderId || row.other.orderId, message: command.message ?? "" };
      if (["unknown", "rejected"].includes(command.state)) { row.manual = true; row.decision = "closed"; row.released = false; }
      break;
    case "facts": row = mergeGtcFacts(row, command.facts); break;
    case "close": closeGtcRound(row); break;
    case "cancel":
      if (!gtcCanCancel(row))
        throw new Error("原单当前不可取消或取消正在处理");
      row.manual = true; row.decision = "closed";
      row.cancel = { commandId: command.commandId, state: "dispatching", message: "正在核对原单取消结果" }; break;
    case "cancel_result":
      if (!["unknown", "failed", "acknowledged"].includes(command.state))
        throw new Error("GTC 取消状态无效");
      if (row.cancel?.commandId !== command.commandId)
        throw new Error("取消命令身份不一致");
      row.cancel.state = command.state; row.cancel.message = command.message; break;
    case "resume":
      if (!gtcCanRelease(row))
        throw new Error("原挂单、成交费用或另一腿仍待核实，不能恢复自动下注");
      row.released = true; row.releaseRevision = row.revision + 1; break;
    case "counted":
      if (row.counted || gtcUnits(row.matched) <= 0n || !row.complete)
        throw new Error("GTC 首笔成交已计数或待核实");
      row.counted = true; break;
  }
  row.revision = previous.revision + 1;
  return row;
}

export function closeGtcRound(row: GtcExecution): void {
  row.decision = "closed";
  if (gtcPmNeverSubmitted(row)) { row.submit = "not_attempted"; row.terminal = true; row.complete = true; row.open = "0"; }
  if (gtcCanFinishWithoutOrders(row)) {
    row.manual = false; row.released = true; row.groupComplete = false;
    return;
  }
  row.groupComplete = !row.manual && row.complete && !row.error && gtcUnits(row.matched) === gtcUnits(row.plan.shares) && row.other.state === "filled";
  if (!row.groupComplete)
    row.manual = true;
  if (row.groupComplete && !row.manual && gtcCanRelease(row))
    row.released = true;
  if (canFinishManualGtc(row))
    row.released = true;
}
