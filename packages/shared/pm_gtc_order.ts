/** [changmen 扩展] PM 单笔 GTC 订单契约与事实归并；保持纯计算，无套利、UI 或存储依赖。 */
export type GtcSubmitState = "prepared" | "not_attempted" | "dispatching" | "accepted" | "rejected" | "unknown";
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
export interface GtcFinancialOrder {
  pmShares: number;
  pmFillPrice: number;
  pmStakeUsdc: number;
  pmFeeUsdc: number;
  odds: number;
  betMoney: number;
}
/** [changmen 扩展] PM 单笔 GTC 买单的冻结签单参数，不携带业务配对或页面信息。 */
export interface GtcOrderPlan {
  tokenId: string;
  conditionId: string;
  shares: string;
  targetShares: string;
  price: string;
  maxPrincipal: string;
  /** 兼容原字段名；保存本金预算上限，不含费用预留。 */
  allInBudget: string;
  feeProof?: GtcFeeProof;
  protocol: 2 | 3;
  negRisk: boolean;
  route: string;
  orderHash: string;
}
export type GtcOrderReference = Pick<GtcOrderPlan, "tokenId" | "conditionId" | "shares" | "feeProof">;
/** 单张 PM 原单的提交、成交及撤单事实；不包含另一腿或套利恢复决策。 */
export interface GtcOrderFactsState {
  plan: Pick<GtcOrderPlan, "orderHash" | "shares">;
  submit: GtcSubmitState;
  orderId: string | null;
  pmAuthorized: boolean;
  submitNotSent?: boolean;
  cancel: { commandId: string; state: "requested" | "dispatching" | "acknowledged" | "unknown" | "failed"; message: string } | null;
  fills: Record<string, GtcFill>;
  order: GtcOrderFact | null;
  matched: string;
  principal: string;
  fee: string | null;
  open: string | null;
  terminal: boolean;
  complete: boolean;
  observedAt: number;
  error: string;
}
export interface GtcOrderState extends GtcOrderFactsState {
  plan: GtcOrderPlan;
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
/** [changmen 扩展] 成交价是金额/份数的比值，CLOB maker 明细可超过六位；数量和预算仍严格使用 gtcUnits。 */
export function gtcFillPrice(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(s))
    throw new Error("GTC 成交价格须为非负十进制");
  const [integer, fraction = ""] = s.split(".");
  const a = BigInt(integer!).toString();
  const b = fraction.replace(/0+$/, "");
  return a + (b ? `.${b}` : "");
}
function fillPriceRatio(value: unknown): { numerator: bigint; denominator: bigint } {
  const [a, b = ""] = gtcFillPrice(value).split(".");
  const denominator = 10n ** BigInt(b.length);
  return { numerator: BigInt(a!) * denominator + BigInt(b || "0"), denominator };
}
export function gtcOrderNeverSubmitted(row: GtcOrderState): boolean {
  return (!row.pmAuthorized || row.submitNotSent === true) && !row.orderId && !row.order && !row.cancel
    && ["prepared", "not_attempted", "rejected"].includes(row.submit)
    && !Object.keys(row.fills).length && gtcUnits(row.matched) === 0n && gtcUnits(row.principal) === 0n;
}
export function canCancelGtcOrder(row: GtcOrderState): boolean {
  return row.submit === "accepted" && Boolean(row.orderId) && !row.terminal
    && row.order?.status !== "DELAYED" && row.open !== "0";
}

/** 合并单个事实，而不是把每次累计快照相加；永久失败不可被旧撮合回放恢复。 */
export function mergeGtcOrderFacts<T extends GtcOrderFactsState>(previous: T, facts: GtcFacts): T {
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
    row.submitNotSent = false;
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
    if (old && (gtcUnits(old.shares) !== gtcUnits(fill.shares) || gtcFillPrice(old.price) !== gtcFillPrice(fill.price))) {
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
    const q = gtcUnits(fill.shares); const p = fillPriceRatio(fill.price);
    if (p.numerator <= 0n || p.numerator >= p.denominator || q <= 0n) { errors.push("成交数量或价格异常"); continue; }
    quantity += q; principal += q * p.numerator / p.denominator;
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
  // 官方原单 MATCHED 已退出挂单；结算舍入可能留下签单数量差额，不能虚构成交或可撤余量。
  const matchedTerminal = status === "MATCHED";
  row.terminal = canceled || matchedTerminal || full || row.submit === "rejected";
  row.open = canceled || matchedTerminal || full
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
  if (row.cancel && row.terminal) {
    row.cancel.state = "acknowledged";
    row.cancel.message = canceled
      ? "原单余量已终止，已成交部分保留"
      : "原单已撮合结束，无可取消挂单；已成交部分保留";
  }
  return row;
}
