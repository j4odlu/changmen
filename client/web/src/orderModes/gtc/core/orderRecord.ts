import type { GtcOrderPlan, GtcOrderState } from "@changmen/shared/pm_gtc_order";
import { canCancelGtcOrder, gtcOrderNeverSubmitted, gtcUnits, mergeGtcOrderFacts } from "@changmen/shared/pm_gtc_order";
import type { GtcOrderReceipt } from "./orderService";

export interface GtcOrderContext {
  linkId?: number;
  match?: string;
  bet?: string;
  item?: string;
}
/** [changmen 扩展] 单张原单及其发送许可；没有双腿、套利计次或业务恢复状态。 */
export interface GtcOrderRecord extends GtcOrderState {
  formatVersion: 2;
  orderType: "GTC";
  id: string;
  owner: string;
  accountId: number;
  maker: string;
  createdAt: number;
  revision: number;
  submissionClosed: boolean;
  context: { linkId: number; match: string; bet: string; item: string };
}
export function isNativeGtcOrder(value: unknown): value is GtcOrderRecord {
  return Boolean(value && typeof value === "object" && "formatVersion" in value && value.formatVersion === 2);
}
export type GtcOrderCommand =
  | { kind: "authorize" | "close" }
  | { kind: "receipt"; receipt: GtcOrderReceipt }
  | { kind: "unknown"; message: string }
  | { kind: "facts"; facts: Parameters<typeof mergeGtcOrderFacts>[1] }
  | { kind: "cancel"; commandId: string }
  | { kind: "cancel_result"; commandId: string; state: "acknowledged" | "failed" | "unknown"; message: string };

export function createGtcOrderRecord(id: string, owner: string, accountId: number, maker: string, plan: GtcOrderPlan, context: GtcOrderContext, now: number): GtcOrderRecord {
  if (!owner || !Number.isSafeInteger(accountId) || accountId <= 0 || !/^0x[0-9a-f]{64}$/i.test(plan.orderHash))
    throw new Error("GTC 订单身份无效");
  if (gtcUnits(plan.price) <= 0n || gtcUnits(plan.price) >= 1_000_000n || gtcUnits(plan.shares) <= 0n
    || gtcUnits(plan.shares) > gtcUnits(plan.targetShares) || gtcUnits(plan.maxPrincipal) <= 0n
    || gtcUnits(plan.maxPrincipal) > gtcUnits(plan.allInBudget) || !plan.tokenId || !plan.conditionId
    || ![2, 3].includes(plan.protocol) || typeof plan.negRisk !== "boolean")
    throw new Error("GTC 签单数量、价格或预算无效");
  const linkId = context.linkId ?? -now;
  if (!Number.isSafeInteger(linkId) || !Number.isFinite(now) || now <= 0
    || [context.match ?? "", context.bet ?? "", context.item ?? ""].some(value => typeof value !== "string" || value.length > 10000))
    throw new Error("GTC 订单关联或展示信息无效，尚未发送订单");
  // 显式拷贝白名单，发送函数、凭证与业务额外字段不能进入记录。
  const frozen: GtcOrderPlan = { tokenId: plan.tokenId, conditionId: plan.conditionId, shares: plan.shares, targetShares: plan.targetShares,
    price: plan.price, maxPrincipal: plan.maxPrincipal, allInBudget: plan.allInBudget, protocol: plan.protocol,
    negRisk: plan.negRisk, route: plan.route, orderHash: plan.orderHash };
  return { formatVersion: 2, orderType: "GTC", id, owner, accountId, maker, plan: frozen, createdAt: now, revision: 0,
    submissionClosed: false, context: { linkId, match: context.match ?? "", bet: context.bet ?? "", item: context.item ?? "" },
    submit: "prepared", orderId: null, pmAuthorized: false, cancel: null, fills: {}, order: null,
    matched: "0", principal: "0", fee: "0", open: null, terminal: false, complete: false, observedAt: 0, error: "" };
}

export function applyGtcOrderCommand(previous: GtcOrderRecord, command: GtcOrderCommand): GtcOrderRecord {
  let row = structuredClone(previous);
  switch (command.kind) {
    case "authorize":
      if (row.pmAuthorized || row.submissionClosed || !gtcOrderNeverSubmitted(row))
        throw new Error("GTC 原单已授权或已结束，禁止重发");
      row.pmAuthorized = true; row.submit = "dispatching"; break;
    case "receipt": {
      if (!row.pmAuthorized) throw new Error("GTC 原单未授权");
      const ack = command.receipt;
      if (ack.pmSubmitNotSent && ack.success === false && !ack.orderID) {
        if (row.orderId || row.order || row.cancel || Object.keys(row.fills).length || gtcUnits(row.matched) > 0n)
          throw new Error("GTC 已有原单证据，不能标为未发送");
        row.submitNotSent = true; row.submit = "not_attempted"; row.terminal = true; row.complete = true; row.open = "0";
        row.error = ack.errorMsg || "发送前检查失败，未提交";
      }
      else if (ack.success === true && ack.orderID) {
        if (ack.orderID.toLowerCase() !== row.plan.orderHash.toLowerCase()) throw new Error("GTC 回执订单身份不一致");
        row.submit = "accepted"; row.orderId = ack.orderID; row.error = "";
      }
      else if (row.submit !== "accepted") {
        row.submit = ack.success === false ? "rejected" : "unknown";
        row.error = ack.errorMsg || "官方受理结果待核实，请勿重复下单";
        if (row.submit === "rejected") { row.terminal = true; row.complete = true; row.open = "0"; }
      }
      break;
    }
    case "unknown":
      if (!row.pmAuthorized) throw new Error("GTC 原单未授权");
      if (row.submit !== "accepted") row.submit = "unknown";
      row.error = command.message; break;
    case "facts": row = mergeGtcOrderFacts(row, command.facts); break;
    case "close":
      row.submissionClosed = true;
      if (gtcOrderNeverSubmitted(row)) { row.submit = "not_attempted"; row.terminal = true; row.complete = true; row.open = "0"; }
      break;
    case "cancel":
      if (!canCancelGtcOrder(row)) throw new Error("原单当前不可取消");
      row.submissionClosed = true;
      row.cancel = { commandId: command.commandId, state: "dispatching", message: "正在核对原单取消结果" }; break;
    case "cancel_result":
      if (row.cancel?.commandId !== command.commandId) throw new Error("取消命令身份不一致");
      row.cancel.state = command.state; row.cancel.message = command.message; break;
  }
  row.revision = previous.revision + 1;
  return row;
}

export function gtcOrderReconciled(row: GtcOrderRecord): boolean {
  if (row.submissionClosed && gtcOrderNeverSubmitted(row)) return true;
  if (!row.terminal || !row.complete || row.error || row.open !== "0") return false;
  if (row.submit === "rejected") return gtcUnits(row.matched) === 0n && !Object.keys(row.fills).length;
  if (row.submit !== "accepted" || !row.order) return false;
  const fills = Object.values(row.fills);
  if (fills.some(fill => !["CONFIRMED", "FAILED"].includes(fill.status))) return false;
  const valid = fills.filter(fill => fill.status !== "FAILED");
  return valid.every(fill => fill.fee != null && Number.isFinite(Number(fill.fee)) && Number(fill.fee) >= 0)
    && valid.reduce((total, fill) => total + gtcUnits(fill.shares), 0n) === gtcUnits(row.matched)
    && gtcUnits(row.order.matched) === gtcUnits(row.matched)
    && row.order.tradeIds.every(id => fills.some(fill => fill.tradeId === id));
}
