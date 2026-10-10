/** [changmen 扩展] GTC V1 独立事实与决策契约；不被 FOK adapter 消费。 */
export const PM_GTC_VERSION = 1;
export const PM_GTC_INITIAL_MS = 10_000;
export type GtcSubmitState = "prepared" | "not_attempted" | "dispatching" | "accepted" | "rejected" | "unknown";
export type GtcOtherState = "not_attempted" | "authorized" | "accepted" | "pending" | "filled" | "rejected" | "unknown";
export interface GtcFeeProof { rate: string; exponent: 1; takerOnly: true; observedAt: number }
export interface GtcFill {
  key: string;
  tradeId: string;
  bucket: string;
  role: "MAKER" | "TAKER";
  shares: string;
  price: string;
  fee: string | null;
  status: string;
  updatedAt: number;
}
export interface GtcOrderFact {
  /** 原单查询缺失时，只有完整原单 CONFIRMED 成交可证明全部成交。 */
  source?: "confirmed-trades";
  id: string;
  original: string;
  matched: string;
  status: string;
  tradeIds: string[];
}
export interface GtcFacts {
  order: GtcOrderFact | null;
  fills: GtcFill[];
  complete: boolean;
  observedAt: number;
  error?: string;
}
/** 普通 PM 成交助手的财务结果；GTC 持久化不另算费用、金额或赔率。 */
export interface GtcFinancialOrder {
  pmShares: number;
  pmFillPrice: number;
  pmStakeUsdc: number;
  pmFeeUsdc: number;
  odds: number;
  betMoney: number;
}
export interface GtcPlan {
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
  tokenId: string;
  conditionId: string;
  target: "Home" | "Away";
  match: string;
  bet: string;
  item: string;
  shares: string;
  targetShares: string;
  price: string;
  maxPrincipal: string;
  allInBudget: string;
  feeProof: GtcFeeProof;
  fx: number;
  parallel: boolean;
  protocol: 2 | 3;
  negRisk: boolean;
  route: string;
  orderHash: string;
}
export interface GtcExecution {
  financialOrder?: GtcFinancialOrder;
  id: string;
  owner: string;
  walletKey: string;
  maker: string;
  plan: GtcPlan;
  createdAt: number;
  revision: number;
  submit: GtcSubmitState;
  orderId: string | null;
  decision: "open" | "closed";
  deadlineAt: number;
  pmAuthorized: boolean;
  other: { state: GtcOtherState; orderId: string | null; submittedAt: number; message: string };
  manual: boolean;
  released: boolean;
  releaseRevision?: number;
  cancel: { commandId: string; state: "requested" | "dispatching" | "acknowledged" | "unknown" | "failed"; message: string } | null;
  fills: Record<string, GtcFill>;
  order: GtcOrderFact | null;
  matched: string;
  principal: string;
  fee: string | null;
  open: string | null;
  terminal: boolean;
  complete: boolean;
  groupComplete: boolean;
  observedAt: number;
  error: string;
  counted: boolean;
}
const UNIT = 1_000_000n;
export function gtcUnits(value: unknown): bigint {
  const s = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(s))
    throw new Error("GTC 数值须为最多六位的非负十进制");
  const [a, b = ""] = s.split(".");
  return BigInt(a!) * UNIT + BigInt(b.padEnd(6, "0"));
}
export function gtcDecimal(value: bigint): string {
  if (value < 0n)
    throw new Error("GTC 数值不可为负");
  const fraction = String(value % UNIT).padStart(6, "0").replace(/0+$/, "");
  return String(value / UNIT) + (fraction ? `.${fraction}` : "");
}
export function gtcNumber(value: unknown): number { return Number(gtcDecimal(gtcUnits(value))); }
/** [changmen 扩展] 兼容旧版把未授权 PM 腿写成 rejected 的记录；有任何订单证据就不能据此结束。 */
export function gtcPmNeverSubmitted(row: GtcExecution): boolean {
  return !row.pmAuthorized && !row.orderId && !row.order && !row.cancel
    && ["prepared", "not_attempted", "rejected"].includes(row.submit)
    && !Object.keys(row.fills).length && gtcUnits(row.matched) === 0n && gtcUnits(row.principal) === 0n;
}
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
export function gtcCanAuthorizeOther(row: GtcExecution, now: number): boolean {
  if (row.plan.source === "manual")
    return false;
  if (row.manual || row.cancel || row.decision !== "open" || row.other.state !== "not_attempted")
    return false;
  if (row.plan.parallel || row.plan.originalPmLeg === "B")
    return true;
  return row.pmAuthorized && row.submit === "accepted" && gtcUnits(row.matched) > 0n
    && row.complete && !row.error && row.deadlineAt > now;
}
export function gtcCanCancel(row: GtcExecution): boolean {
  return row.submit === "accepted" && Boolean(row.orderId) && !row.terminal
    && row.order?.status !== "DELAYED" && row.open !== "0"
    && row.cancel?.state !== "dispatching";
}
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

/** 合并单个事实，而不是把每次累计快照相加；永久失败不可被旧撮合回放恢复。 */
export function mergeGtcFacts(previous: GtcExecution, facts: GtcFacts): GtcExecution {
  const row = structuredClone(previous);
  const errors: string[] = [];
  const expectedId = (row.orderId || row.plan.orderHash).toLowerCase();
  if (facts.order) {
    if (facts.order.id.toLowerCase() !== expectedId || gtcUnits(facts.order.original) !== gtcUnits(row.plan.shares))
      throw new Error("GTC 原单身份或签单数量不一致");
    const incoming = facts.order;
    // 成交回滚由明确 FAILED 证据解释；普通迟到累计量不得倒退。
    const decreases = row.order && gtcUnits(incoming.matched) < gtcUnits(row.order.matched);
    const failed = facts.fills.some(fill => fill.status === "FAILED");
    const wasCanceled = ["CANCELED", "CANCELLED"].includes(row.order?.status ?? "");
    if (!decreases || failed)
      row.order = structuredClone(incoming);
    if (wasCanceled && row.order) {
      if (!["CANCELED", "CANCELLED", "MATCHED"].includes(incoming.status))
        row.order.status = "CANCELED";
    }
    row.orderId ||= facts.order.id;
    row.submit = "accepted";
  }
  for (const fill of facts.fills) {
    if (!fill.key || !fill.tradeId || !["MAKER", "TAKER"].includes(fill.role))
      throw new Error("GTC 成交身份缺失");
    const old = row.fills[fill.key];
    if (old?.status === "FAILED" && fill.status !== "FAILED")
      continue;
    if (old && fill.updatedAt < old.updatedAt)
      continue;
    if (old?.status === "CONFIRMED" && fill.status !== "CONFIRMED" && fill.status !== "FAILED")
      continue;
    if (old && (gtcUnits(old.shares) !== gtcUnits(fill.shares) || gtcUnits(old.price) !== gtcUnits(fill.price))) {
      errors.push("同一成交明细数量或价格冲突"); continue;
    }
    row.fills[fill.key] = fill;
  }
  let quantity = 0n;
  let principal = 0n;
  let fee = 0n;
  let feeUnknown = false;
  for (const fill of Object.values(row.fills)) {
    if (fill.status === "FAILED")
      continue;
    const q = gtcUnits(fill.shares); const p = gtcUnits(fill.price);
    if (p <= 0n || p >= UNIT || q <= 0n) { errors.push("成交数量或价格异常"); continue; }
    quantity += q; principal += q * p / UNIT;
    if (fill.fee == null)
      feeUnknown = true;
    else fee += gtcUnits(fill.fee);
  }
  const total = gtcUnits(row.plan.shares);
  if (quantity > total)
    errors.push("成交数量超过原签单量");
  const orderMatched = row.order ? gtcUnits(row.order.matched) : null;
  if (orderMatched != null && orderMatched !== quantity)
    errors.push("原单累计量与成交明细未一致");
  const failedAmount = Object.values(row.fills).filter(f => f.status === "FAILED").reduce((q, f) => q + gtcUnits(f.shares), 0n);
  // FAILED 量不继续计作已买入；官方累计量未修订时显示冲突并保留阻断。
  row.matched = gtcDecimal(failedAmount > 0n ? quantity : orderMatched != null && orderMatched > quantity ? orderMatched : quantity);
  row.principal = gtcDecimal(principal);
  row.fee = feeUnknown ? null : gtcDecimal(fee);
  if (feeUnknown)
    errors.push("成交费用待核实");
  const status = row.order?.status ?? "";
  const canceled = ["CANCELED", "CANCELLED", "EXPIRED", "REJECTED"].includes(status);
  const full = orderMatched != null && orderMatched === total && quantity === total;
  row.terminal = canceled || full || row.submit === "rejected";
  row.open = canceled || full
    ? "0"
    : row.order && ["LIVE", "DELAYED", "UNMATCHED", "MATCHED"].includes(status)
      && orderMatched != null && orderMatched <= total
      ? gtcDecimal(total - orderMatched)
      : null;
  const knownIds = new Set(Object.values(row.fills).map(f => f.tradeId));
  if (row.order?.tradeIds.some(id => !knownIds.has(id)))
    errors.push("原单关联成交明细缺失");
  row.complete = Boolean(facts.complete && row.order && !errors.length && !facts.error);
  row.error = facts.error || errors.join("；");
  row.observedAt = Math.max(row.observedAt, facts.observedAt);
  row.groupComplete = !row.manual && full && row.complete && row.other.state === "filled";
  if (row.cancel && row.terminal)
    row.cancel.state = "acknowledged";
  if (row.released && (!row.complete || row.error || !row.terminal)) {
    row.released = false; row.manual = true;
  }
  if (!row.manual && row.groupComplete && gtcCanRelease(row))
    row.released = true;
  // 手动单没有第二腿/套利恢复操作；原单已终止且明细确认后自动释放协调占用。
  if (canFinishManualGtc(row))
    row.released = true;
  return row;
}

type GtcCommandBody
  = | { kind: "authorize_pm" | "authorize_other" | "close" | "resume" | "counted" }
    | { kind: "ack"; state: "accepted" | "rejected" | "unknown"; orderId?: string; message?: string }
    | { kind: "other"; state: GtcOtherState; orderId?: string; message?: string }
    | { kind: "facts"; facts: GtcFacts }
    | { kind: "cancel"; commandId: string }
    | { kind: "cancel_result"; commandId: string; state: "unknown" | "failed" | "acknowledged"; message: string };

export type GtcCommand = GtcCommandBody & { financialOrder?: GtcFinancialOrder };

/** 所有一次性提交授权在数据库行锁内调用；客户端重放只能读，不能再获授权。 */
export function applyGtcCommand(previous: GtcExecution, command: GtcCommand, now: number): GtcExecution {
  let row = structuredClone(previous);
  switch (command.kind) {
    case "authorize_pm":
      if (row.pmAuthorized || row.decision !== "open" || row.manual)
        throw new Error("GTC 原单已授权或已结束；禁止重发");
      row.pmAuthorized = true; row.submit = "dispatching"; row.deadlineAt = now + PM_GTC_INITIAL_MS; break;
    case "authorize_other":
      if (!gtcCanAuthorizeOther(row, now))
        throw new Error("GTC 第二腿不可再次提交");
      row.other.state = "authorized"; row.other.submittedAt = now; break;
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
