import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { isPolymarketTradeFailureRow } from "./tradeFailure";
import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import type { VenueOrder } from "../contract";
import { parseTokenConfig, resolveApiCreds } from "./l2Auth";
import { pmGetOrder, pmGetOpenOrders } from "./pmClientApi";
import { tracePolymarketOrder, polymarketReadErrorDetails } from "./orderTrace";
import type {
  PolymarketOrderResponseLike,
  PolymarketOrderRow,
  PolymarketPollOutcome,
} from "./orderTypes";

export type { PolymarketOrderResponseLike, PolymarketOrderRow, PolymarketPollOutcome } from "./orderTypes";

/** POST /order 返回 delayed 且尚无 takingAmount：延迟窗内，未最终成交 */
export function isPolymarketDelayedPending(
  result: PolymarketOrderResponseLike | null | undefined,
): boolean {
  if (!result?.success)
    return false;
  const status = String(result.status ?? "").trim().toLowerCase();
  if (status !== "delayed")
    return false;
  const orderId = String(result.orderID ?? "").trim();
  if (!orderId)
    return false;
  const taking = Number(result.takingAmount);
  return !(Number.isFinite(taking) && taking > 0);
}

/** POST 已 matched 且 takingAmount>0：勿因 getOrders 滞后误判拒单 */
export function isPolymarketPostFillConfirmed(
  response: PolymarketOrderResponseLike | null | undefined,
): boolean {
  if (!response?.success)
    return false;
  const status = String(response.status ?? "").trim().toLowerCase();
  if (status !== "matched")
    return false;
  const taking = Number(response.takingAmount);
  return Number.isFinite(taking) && taking > 0;
}

export function isPolymarketBetResultFillConfirmed(result: BetResult): boolean {
  if (!result.success || result.pending)
    return false;
  const orderId = String(result.orderId ?? "").trim();
  if (!orderId)
    return false;
  return isPolymarketPostFillConfirmed(
    result.response as PolymarketOrderResponseLike | undefined,
  );
}

/** 仅当本单 orderId 在列表中为 reject 时判拒；列表滞后时不继承其它旧拒单 */
export function isPolymarketOrderIdRejected(
  orders: VenueOrder[],
  orderId: string | null | undefined,
): boolean {
  const id = String(orderId ?? "").trim();
  if (!id)
    return orders.length > 0 && orders[0].status === "reject";
  const ours = orders.find(o => o.orderId === id);
  if (ours)
    return ours.status === "reject";
  return false;
}

function parseMatchedSize(row: PolymarketOrderRow | null | undefined): number {
  const matched = Number(row?.size_matched);
  return Number.isFinite(matched) && matched > 0 ? matched : 0;
}

/** 官网明确挂簿且无成交（FOK 收尾：grace 后再 cancel）；delayed 不可撤。 */
export function isPolymarketRestingNoFill(
  row: PolymarketOrderRow | null | undefined,
): boolean {
  if (!row || Object.keys(row).length === 0)
    return false;
  if (parseMatchedSize(row) > 0)
    return false;
  const trades = row.associate_trades;
  if (Array.isArray(trades) && trades.length > 0)
    return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  return status === "live" || status === "unmatched";
}

/** GET /data/order 暂无行：官方 delay 窗内常见，勿立刻 cancel */
export function isPolymarketDelayLookupPending(
  row: PolymarketOrderRow | null | undefined,
): boolean {
  return !row || Object.keys(row).length === 0;
}

/** GET /data/order/{id} 行解读（对齐官方 Order Lifecycle） */
export function interpretPolymarketOrderRow(
  row: PolymarketOrderRow | null | undefined,
): "matched" | "unfilled" | "pending" {
  // 端点暂未返回 / 404：体育 delay 窗内常见，勿误判为 FOK 拒单
  if (!row)
    return "pending";
  if (Object.keys(row).length === 0)
    return "pending";
  if (isPolymarketTradeFailureRow(row))
    return "unfilled";
  const status = String(row.status ?? "").trim().toLowerCase();
  if (parseMatchedSize(row) > 0)
    return "matched";
  const trades = row.associate_trades;
  if (Array.isArray(trades) && trades.length > 0)
    return "matched";
  // delayed：官方 delay 窗内，仍待确认
  if (status === "delayed")
    return "pending";
  // live/unmatched：官网挂簿态；FOK 应很快系统 cancel 或 matched，非终态未成交
  if (status === "live" || status === "unmatched")
    return "pending";
  if (
    status.includes("cancel")
    || status.includes("kill")
    || status === "expired"
  ) {
    return row.size_matched != null && String(row.size_matched).trim() !== ""
      && Number(row.size_matched) === 0 ? "unfilled" : "pending";
  }
  // matched 但无份额：接口滞后时常见，勿立刻当拒单
  if (status === "matched")
    return "pending";
  return "pending";
}

export async function fetchPolymarketOrderRow(
  account: PlatformAccount,
  orderId: string,
): Promise<PolymarketOrderRow | null> {
  const id = String(orderId ?? "").trim();
  if (!id)
    return null;
  const config = parseTokenConfig(account.token);
  const creds = resolveApiCreds(config);
  if (!creds.apiKey || !creds.secret || !creds.passphrase || !creds.address)
    throw new Error("PM 订单核验缺少鉴权信息");
  let data: PolymarketOrderRow | null;
  const startedAt = Date.now();
  try {
    data = await pmGetOrder<PolymarketOrderRow | null>(account, id);
    tracePolymarketOrder(account.accountId, id, "order_read", { startedAt, endpoint: "single_order", orderRead: data == null ? "empty" : "found", status: data?.status });
  }
  catch (error) {
    tracePolymarketOrder(account.accountId, id, "order_read", { startedAt, endpoint: "single_order", orderRead: "error", ...polymarketReadErrorDetails(error) });
    const status = (error as { status?: number; response?: { status?: number } })?.response?.status
      ?? (error as { status?: number })?.status;
    if (status !== 404)
      throw error;
    data = null;
  }
  if (data == null) {
    const listStartedAt = Date.now();
    let response: PolymarketOrderRow[] | { data: PolymarketOrderRow[] };
    try {
      response = await pmGetOpenOrders<PolymarketOrderRow[] | { data: PolymarketOrderRow[] }>(account, undefined, id);
    }
    catch (error) {
      tracePolymarketOrder(account.accountId, id, "order_read", { startedAt: listStartedAt, endpoint: "order_list_by_id", orderRead: "error", ...polymarketReadErrorDetails(error) });
      throw error;
    }
    const rows = Array.isArray(response) ? response : response?.data;
    if (!Array.isArray(rows))
      throw new Error("PM 订单列表查询返回非列表响应");
    data = rows.find(row => String(row.id).toLowerCase() === id.toLowerCase()) ?? null;
    tracePolymarketOrder(account.accountId, id, "order_read", { startedAt: listStartedAt, endpoint: "order_list_by_id", orderRead: data == null ? "empty" : "found", status: data?.status });
  }
  if (data != null && (typeof data !== "object" || !("status" in data)))
    throw new Error("PM 订单查询返回非订单响应");
  if (data?.id && data.id.toLowerCase() !== id.toLowerCase())
    throw new Error("PM 订单查询 ID 不匹配");
  return data ?? null;
}

function wait(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * 体育 delayed 轮询默认值（市场 `sd` 未知时）。
 * 官方 [Order Lifecycle](https://docs.polymarket.com/concepts/order-lifecycle)：
 * - 体育/比赛盘 marketable → 异步 delay 窗，时长见 CLOB `GET /clob-markets/{id}` 的 `sd`（秒）
 * - 加密/金融 taker delay 250ms（`itode`），API 同步等到结果，通常不返回 `delayed`
 * 有 conditionId 时用 `buildPolymarketDelayedPollOpts(sd)`（见 marketDelay.ts）。
 * 未知 `sd` 不得用本常量当官方缺省（文档无缺省秒数）；fallback 走 `resolvePolymarketDelayedPollOpts`（保守 30s）。
 */
export const POLYMARKET_SPORTS_DELAYED_POLL_OPTS = {
  initialDelayMs: 1_000,
  intervalMs: 1_000,
  maxAttempts: 12,
} as const;

/**
 * order 仍 pending 时用 /data/trades 兜底（官网：成交后 MATCHED→MINED→CONFIRMED，链上需额外时间）。
 * 最多约 30s，应对 order 端点滞后于 trades 的情况。
 */
export const POLYMARKET_DELAYED_TRADE_CONFIRM_OPTS = {
  lookbackMs: 10 * 60 * 1000,
  retryMs: 2_000,
  maxRetries: 15,
} as const;

/**
 * WS 未命中后的 REST 轮询默认（`sd` 未知）。
 * 有 `sd` 时 settlement job / settle 应传入 `buildPolymarketDelayedPollOpts(sd)`。
 */
export const POLYMARKET_WS_FALLBACK_POLL_OPTS = {
  initialDelayMs: POLYMARKET_SPORTS_DELAYED_POLL_OPTS.initialDelayMs,
  intervalMs: POLYMARKET_SPORTS_DELAYED_POLL_OPTS.intervalMs,
  maxAttempts: 10,
} as const;

export const POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS = {
  lookbackMs: 10 * 60 * 1000,
  retryMs: 2_000,
  maxRetries: 8,
} as const;

export async function pollPolymarketDelayedOrder(
  account: PlatformAccount,
  orderId: string,
  opts?: { initialDelayMs?: number; intervalMs?: number; maxAttempts?: number },
): Promise<{ outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null }> {
  const initialDelayMs = opts?.initialDelayMs ?? 2000;
  const intervalMs = opts?.intervalMs ?? 2000;
  const maxAttempts = opts?.maxAttempts ?? 15;
  await wait(initialDelayMs);
  let last: PolymarketOrderRow | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    last = await fetchPolymarketOrderRow(account, orderId);
    const state = interpretPolymarketOrderRow(last);
    if (state === "matched")
      return { outcome: "matched", row: last };
    if (state === "unfilled")
      return { outcome: "unfilled", row: last };
    if (i < maxAttempts - 1)
      await wait(intervalMs);
  }
  return { outcome: "timeout", row: last };
}

/**
 * [changmen 扩展] 恢复 051ae854 前的 FOK 收尾映射。
 * 核验耗尽后 timeout 按 unfilled 处理；这是本地退出策略，并非官方拒单证据。
 */
export function coercePolymarketFokPollOutcome(
  outcome: PolymarketPollOutcome,
): Exclude<PolymarketPollOutcome, "timeout"> {
  return outcome === "matched" ? "matched" : "unfilled";
}

export function formatPolymarketSettlementMessage(
  orderId: string,
  outcome: PolymarketPollOutcome,
  row: PolymarketOrderRow | null,
): string {
  const id = String(orderId).trim();
  if (outcome === "matched") {
    const size = parseMatchedSize(row);
    const status = String(row?.status ?? "matched").trim();
    return `${id} / ${status} / 已成交${size > 0 ? ` ${size} shares` : ""}`;
  }
  if (outcome === "unfilled" && row?.confirmationBasis === "timeout_policy")
    return `${id} / 按未成交处理 / 核验耗尽，按超时策略判拒（非官方拒单回执）`;
  if (outcome === "unfilled" && isPolymarketTradeFailureRow(row))
    return `${id} / 下单失败 / 官方 trade FAILED（${row?.associate_trades?.[0]}）`;
  if (outcome === "unfilled")
    return `${id} / 未成交 / 延迟后未吃到`;
  return `${id} / 待确认 / 核验诊断：${row?.lookupError || "本轮超时，未取得成交或取消终态"}`;
}

/**
 * [changmen 扩展] 恢复 051ae854 前买入腿的核验耗尽退出策略。
 * 只在完成核验后应用，不把本地策略伪造成 CANCELED；已有成交证据不得被改成拒单。
 * 手动卖出仍使用原始核验结果，不调用此策略。
 */
export function applyPolymarketBuyTimeoutPolicy(settled: {
  outcome: PolymarketPollOutcome;
  row: PolymarketOrderRow | null;
}): { outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null } {
  if (settled.outcome !== "timeout" || interpretPolymarketOrderRow(settled.row) === "matched")
    return settled;
  return {
    outcome: coercePolymarketFokPollOutcome(settled.outcome),
    row: { ...settled.row, confirmationBasis: "timeout_policy" },
  };
}

/**
 * 拒单检测收尾。
 * timeout：本地轮询未出终态 → 保持 pending，不设 reject（对用户非终态，须续跟）。
 */
export function applyPolymarketSettlementToResult(
  result: BetResult,
  outcome: PolymarketPollOutcome,
  row: PolymarketOrderRow | null,
): void {
  result.message = formatPolymarketSettlementMessage(String(result.orderId ?? ""), outcome, row);
  if (outcome === "timeout") {
    result.pending = true;
    if (result.reject === "timeout")
      result.reject = null;
    return;
  }
  result.pending = false;
  if (outcome === "unfilled")
    result.reject = "unfilled";
  else if (result.reject)
    result.reject = null;
}

/** 执行下单后未成交（统计拒单率）；timeout 不落库 */
export type PolymarketExecutionRejectReason = "unfilled" | "api_failed";

export interface PolymarketRejectOrderContext {
  /**
   * 场馆 USDC（checkBetting 换算后 / POST makerAmount）。
   * 落库前会写入 pmStakeUsdc，并把 betMoney scale 成 CNY。
   */
  betMoney?: number;
  odds?: number;
  game?: string;
  match?: string;
  bet?: string;
  item?: string;
  link?: number;
  createAt?: number;
}

/** 官方 orderId（含失败 POST 的 response.orderID）；无则合成稳定主键 */
export function resolvePolymarketRejectOrderId(
  account: PlatformAccount,
  result: BetResult,
  reason: PolymarketExecutionRejectReason,
): string {
  const fromResult = String(result.orderId ?? "").trim();
  if (fromResult)
    return fromResult;
  const fromResponse = String(
    (result.response as { orderID?: string } | undefined)?.orderID ?? "",
  ).trim();
  if (fromResponse)
    return fromResponse;
  const begin = Number(result.beginTime);
  const ts = Number.isFinite(begin) && begin > 0 ? begin : Date.now();
  const player = Number(account.accountId) || 0;
  return `pm-rej-${player}-${ts}-${reason}`;
}

function round4Usdc(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 拒单本金（USDC）：优先 POST body makerAmount（BUY 抵押），否则 ctx.betMoney（已是场馆 U）。
 */
export function resolvePolymarketRejectStakeUsdc(
  result: BetResult,
  ctx: PolymarketRejectOrderContext = {},
): number {
  const req = result.request as {
    order?: { makerAmount?: string | number; side?: string };
  } | undefined;
  const makerRaw = Number(req?.order?.makerAmount);
  if (Number.isFinite(makerRaw) && makerRaw > 0) {
    const fromMaker = makerRaw >= 1000 ? makerRaw / 1_000_000 : makerRaw;
    if (fromMaker > 0)
      return round4Usdc(fromMaker);
  }
  const fromCtx = Number(ctx.betMoney);
  if (Number.isFinite(fromCtx) && fromCtx > 0)
    return round4Usdc(fromCtx);
  return 0;
}

/** 已调用 CLOB POST 后的失败（非预检/凭证/盘口挡单） */
export function isPolymarketPostedApiFailure(result: BetResult): boolean {
  if (result.pmSubmitUnknown) return false;
  const tip = result.tip;
  if (tip && typeof tip === "object" && (tip as { pmPosted?: boolean }).pmPosted === true)
    return true;
  const orderId = String(result.orderId ?? "").trim()
    || String((result.response as { orderID?: string } | undefined)?.orderID ?? "").trim();
  return Boolean(orderId) && result.success === false;
}

/** PM FOK 未成交 / 内存判定：合成 reject 订单供 isVenueReject 统一判定 */
export function buildPolymarketRejectVenueOrder(
  account: PlatformAccount,
  result: BetResult,
  outcome: "unfilled",
  ctx: PolymarketRejectOrderContext = {},
): VenueOrder {
  const createAt = Number(ctx.createAt) > 0
    ? Number(ctx.createAt)
    : (Number(result.beginTime) > 0 ? Number(result.beginTime) : Date.now());
  const orderId = resolvePolymarketRejectOrderId(account, result, "unfilled");
  return {
    provider: account.provider,
    orderId,
    odds: Number(ctx.odds) > 0 ? Number(ctx.odds) : 0,
    createAt,
    betMoney: Number(ctx.betMoney) > 0 ? Number(ctx.betMoney) : 0,
    reward: 0,
    money: 0,
    status: "reject",
    game: String(ctx.game ?? ""),
    match: String(ctx.match ?? ""),
    bet: String(ctx.bet ?? "").trim() || "FOK未成交",
    item: String(ctx.item ?? ""),
    pmSide: "buy",
    pmOrigin: "changmen",
    pmRejectReason: outcome,
    ...(Number(ctx.link) ? { link: Number(ctx.link) } : {}),
  };
}

/** 已执行下单但未成交 → 落库用 Reject（timeout 勿调用） */
export function buildPolymarketExecutionRejectVenueOrder(
  account: PlatformAccount,
  result: BetResult,
  reason: PolymarketExecutionRejectReason,
  ctx: PolymarketRejectOrderContext = {},
): VenueOrder {
  const createAt = Number(ctx.createAt) > 0
    ? Number(ctx.createAt)
    : (Number(result.beginTime) > 0 ? Number(result.beginTime) : Date.now());
  const betLabel = reason === "api_failed"
    ? (String(ctx.bet ?? "").trim() || "下单未成交")
    : (String(ctx.bet ?? "").trim() || "FOK未成交");
  // ctx.betMoney / makerAmount 为场馆 USDC；对齐成交单：pmStakeUsdc=U，betMoney=CNY
  const stakeUsdc = resolvePolymarketRejectStakeUsdc(result, ctx);
  const betMoneyCny = stakeUsdc > 0 ? scaleUsdtToCnyDisplay(stakeUsdc) : 0;
  return {
    provider: account.provider,
    orderId: resolvePolymarketRejectOrderId(account, result, reason),
    odds: Number(ctx.odds) > 0 ? Number(ctx.odds) : 0,
    createAt,
    betMoney: betMoneyCny,
    reward: 0,
    money: 0,
    status: "reject",
    game: String(ctx.game ?? ""),
    match: String(ctx.match ?? ""),
    bet: betLabel,
    item: String(ctx.item ?? ""),
    pmSide: "buy",
    pmOrigin: "changmen",
    pmRejectReason: reason,
    ...(stakeUsdc > 0 ? { pmStakeUsdc: stakeUsdc } : {}),
    ...(Number(ctx.link) ? { link: Number(ctx.link) } : {}),
    // 回填脚本幂等标记（经 raw 落库）
    pmRejectMoneyFixedAt: Date.now(),
  };
}
