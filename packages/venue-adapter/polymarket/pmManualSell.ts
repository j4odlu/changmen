/**
 * [changmen 扩展] 订单栏手动卖出（单买单）。
 *
 * 契约：只执行「卖当前这张买单的剩余份额」并返回结果。
 * - 先买后卖；每个卖出按钮只绑定当前买单
 * - 不撤挂单、不碰其它买单/卖单、不回挂止盈
 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "../contract";
import { PLATFORMS } from "../shared/platforms";
import { POLYMARKET_CLOB_API } from "./api";
import {
  parseTokenConfig,
  resolveApiCreds,
  resolvePrivateKey,
  type PolymarketTokenConfig,
} from "./l2Auth";
import { pmPrepareSubmit, pmSubmitClockReady, pmGetBook, pmSubmitOrder } from "./pmClientApi";
import { resolvePmOrderSubmitHttpMode } from "./pmOrderSubmitMode";
import { getPolymarketOrderClientRuntime, polymarketSigningGeneration } from "./pmOrderClientCache";
import { polymarketMarketOrderOptions } from "./pmMarketOrderOptions";
import { guardedPmSubmit, PmSubmitUnknownError, finishPmSubmitAttempt } from "./pmSubmitJournal";
import { pmSubmitAttemptForOrder } from "./pmSubmitJournal";
import { recoverPmUnknownSubmission } from "./pmUnknownSubmitRecovery";
import { markPolymarketChangmenOrder } from "./pmOrigin";
import {
  hasOpenPolymarketPosition,
  resolveBuyStakeUsdc,
  resolvePmFillShares,
  resolvePmRemainingShares,
  venueOrderFromOrderRow,
  type OrderRowLike,
} from "./pmLogicalPosition";
import { estimatePolymarketSellProceedsUsdc, type PolymarketBidLevel } from "./parse";
import {
  UNKNOWN_SPORTS_SECONDS_DELAY,
  buildPolymarketDelayedPollOpts,
  buildPolymarketWatchTimeoutMs,
  fetchPolymarketMarketSecondsDelay,
} from "./marketDelay";
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import {
  parsePolymarketSellOrderFill,
  POLYMARKET_SELL_FILL_RETRY_OPTS,
  polymarketShareCount,
  resolvePolymarketSellFillWithRetry,
} from "./orders";
import {
  fetchPolymarketOrderRow,
  interpretPolymarketOrderRow,
  POLYMARKET_DELAYED_TRADE_CONFIRM_OPTS,
} from "./orderStatus";
import {
  isPolymarketPriceOnTick,
  type PolymarketTickSize,
} from "./pmTickPrice";
import { polymarketCnyFromUsdt } from "./pmStake";
import {
  awaitPolymarketSettlementJob,
  startPolymarketSettlementJob,
} from "./settlementJob";
import { registerPolymarketOrderWatch } from "./userWs";

type Hex = `0x${string}`;

interface PolymarketOrderBookResponse {
  asset_id?: string;
  version?: string;
  tick_size?: string | number;
  minimum_tick_size?: string | number;
  min_order_size?: string | number;
  neg_risk?: boolean;
  bids?: Array<{ price?: string | number; size?: string | number }>;
}

interface PolymarketOrderResponse {
  success?: boolean;
  errorMsg?: string;
  orderID?: string;
  status?: string;
  makingAmount?: string;
  takingAmount?: string;
}

export interface PolymarketManualSellResult {
  ok: boolean;
  error?: string;
  sellOrderId?: string;
  sharesSold?: number;
  fillPrice?: number;
  proceedsUsdc?: number;
  pending?: boolean;
  pmSubmitUnknown?: boolean;
  /** 待 saveOrders：买单 patch + 卖单（先买后卖，便于同批跟 Link） */
  ordersToSave?: VenueOrder[];
  /** 已确认成交但份数少于请求（仍应落库） */
  partialFill?: boolean;
  /**
   * 链上已拿到 sell orderId。
   * 正常路径会 await 到 filled/unfilled；仅异常中断时仍可能为 true。
   */
  chainSubmitted?: boolean;
  /** CLOB 已确认未成交（FOK 取消等）：可再卖 */
  unfilled?: boolean;
}

/** 平仓确认结果；本地复核耗尽不是场馆终态，必须保持 pending 防止重复卖出。 */
export type PolymarketManualSellFinalOutcome =
  | {
    outcome: "filled";
    sellOrderId: string;
    sharesSold: number;
    proceedsUsdc: number;
    fillPrice: number;
    ordersToSave: VenueOrder[];
    partialFill: boolean;
  }
  | {
    outcome: "unfilled";
    sellOrderId: string;
    reason: string;
  }
  | {
    outcome: "pending";
    sellOrderId: string;
    reason: string;
  };

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function resolveSdkSignatureType(value: string | number | undefined): number {
  const numeric = Number(value ?? 0);
  return [1, 2, 3].includes(numeric) ? numeric : 0;
}

function parseBidsFromBook(book: PolymarketOrderBookResponse | null | undefined): PolymarketBidLevel[] {
  return (book?.bids ?? [])
    .map(level => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter(level =>
      Number.isFinite(level.price)
      && Number.isFinite(level.size)
      && level.price > 0
      && level.price < 1
      && level.size > 0,
    )
    .sort((a, b) => b.price - a.price);
}

/**
 * [changmen 扩展] 按当前 bids 估算全卖回款（USDC）；深度不足或失败返回 0。
 * 供提前锁利等只读估价，不下单。
 */
export async function estimatePolymarketManualSellProceedsUsdc(params: {
  account: PlatformAccount;
  buyRow: OrderRowLike | VenueOrder;
}): Promise<number> {
  try {
    const buy = "provider" in params.buyRow && "orderId" in params.buyRow
      ? params.buyRow as VenueOrder
      : venueOrderFromOrderRow(params.buyRow);
    const tokenId = String(buy.pmTokenId ?? "").trim();
    const sharesWanted = resolvePmRemainingShares(buy) > 0.0001
      ? resolvePmRemainingShares(buy)
      : resolvePmFillShares(buy);
    if (!tokenId || !(sharesWanted > 0))
      return 0;
    const gateway = params.account.gateway || POLYMARKET_CLOB_API;
    const book = await pmGetBook<PolymarketOrderBookResponse>(tokenId, gateway);
    return estimatePolymarketSellProceedsUsdc(parseBidsFromBook(book), sharesWanted);
  }
  catch {
    return 0;
  }
}

/** FOK 卖：worst-price = 吃满份额所需最低 bid 档 */
export function calculateSellMarketLimitPrice(
  bids: PolymarketBidLevel[],
  shares: number,
  minOrderSize: number,
): number {
  if (!Number.isFinite(shares) || shares <= 0)
    throw new Error(`无效卖出份数 ${shares}`);
  if (minOrderSize > 0 && shares + 1e-12 < minOrderSize)
    throw new Error(`卖出份数 ${shares} 低于 min_order_size ${minOrderSize}`);
  if (!bids.length)
    throw new Error("Polymarket 盘口无 bids，无法市价卖出");

  let remaining = shares;
  let worst = 0;
  for (const level of bids) {
    if (remaining <= 0)
      break;
    const fill = Math.min(remaining, level.size);
    worst = level.price;
    remaining -= fill;
  }
  if (remaining > 1e-6)
    throw new Error("Polymarket FOK 卖出深度不足（bids 不够吃满该买单份额）");
  if (!(worst > 0 && worst < 1))
    throw new Error(`无效卖出限价 ${worst}`);
  return worst;
}

async function createPolymarketFokSellOrderBody(
  gateway: string,
  privateKey: Hex,
  creds: ReturnType<typeof resolveApiCreds>,
  config: PolymarketTokenConfig,
  tokenId: string,
  price: number,
  shares: number,
  orderOptions: { tickSize: PolymarketTickSize; negRisk: boolean; version: 2 | 3 },
) {
  const { runtime: { clob, builder, builderCode } } = await getPolymarketOrderClientRuntime({
    gateway, privateKey, creds, config, signatureType: resolveSdkSignatureType(creds.signatureType),
  });
  const signedOrder = await builder.buildMarketOrder({
    tokenID: tokenId,
    price,
    amount: shares,
    side: clob.Side.SELL,
    builderCode,
  }, {
    tickSize: orderOptions.tickSize as any,
    negRisk: orderOptions.negRisk,
  }, orderOptions.version);
  if (!clob.isV2Order(signedOrder))
    throw new Error("Polymarket SDK 未生成 CLOB v2 卖单");
  return clob.orderToJsonV2(signedOrder, creds.apiKey!, clob.OrderType.FOK, false, false);
}

function buildSellAndBuyPatchOrders(params: {
  buy: VenueOrder;
  sellOrderId: string;
  sharesSold: number;
  proceedsUsdc: number;
  fillPrice: number;
  createAt: number;
}): VenueOrder[] {
  const { buy, sellOrderId, sharesSold, proceedsUsdc, fillPrice, createAt } = params;
  const fillShares = resolvePmFillShares(buy);
  const remainingBefore = resolvePmRemainingShares(buy);
  const deduct = Math.min(sharesSold, remainingBefore > 0 ? remainingBefore : fillShares);
  const costUsdc = resolveBuyStakeUsdc(buy);
  const costPortion = remainingBefore > 0.0001
    ? round4(costUsdc * (deduct / remainingBefore))
    : round4(costUsdc);
  const profitUsdc = round4(proceedsUsdc - costPortion);
  const proceedsCny = polymarketCnyFromUsdt(proceedsUsdc);
  const profitCny = Math.round(polymarketCnyFromUsdt(profitUsdc));
  /**
   * 已实现盈亏只累加「卖出归因」。
   * 0.99 启发式 / Gamma 可能已把纸面 win/lose 写入 buy.money；首次卖出时必须丢弃，
   * 否则会出现 proceeds−cost 被加两次（截图 318 = 2×159）。
   */
  const priorAttr = Number(buy.pmAttributedSellShares) || 0;
  const hasPriorSellRealization = priorAttr > 0.0001
    || buy.pmSellState === "partial"
    || buy.pmSellState === "closed";
  const prevRealizedCny = hasPriorSellRealization ? (Number(buy.money) || 0) : 0;
  const prevRealizedUsdc = hasPriorSellRealization ? (Number(buy.pmRealizedPnlUsdc) || 0) : 0;
  const originalBetMoney = Number(buy.betMoney) > 0
    ? Number(buy.betMoney)
    : Math.round(polymarketCnyFromUsdt(costUsdc) * 100) / 100;

  const sell: VenueOrder = {
    provider: PLATFORMS.Polymarket,
    orderId: sellOrderId,
    odds: fillPrice > 0 ? round4(1 / fillPrice) : 0,
    createAt,
    betMoney: proceedsCny,
    reward: 0,
    // [changmen] 已实现盈亏统一记买单；卖单只保留回款流水
    money: 0,
    status: "none",
    game: buy.game,
    match: buy.match,
    bet: buy.bet,
    item: buy.item ? `平仓 ${buy.item}` : "平仓",
    link: Number(buy.link) || undefined,
    pmTokenId: buy.pmTokenId,
    pmShares: sharesSold,
    pmFillPrice: fillPrice,
    pmStakeUsdc: costPortion,
    pmConditionId: buy.pmConditionId,
    pmOrigin: "changmen",
    pmSide: "sell",
    pmBuyOrderId: buy.orderId,
    pmRealizedPnlUsdc: profitUsdc,
  };

  const attributedRaw = round4((buy.pmAttributedSellShares ?? 0) + deduct);
  // FOK 卖出份数常四舍五入短一截（如 48.23 vs 48.2353），剩余尘量视为已卖光
  const remainingAfter = resolvePmRemainingShares({
    ...buy,
    pmAttributedSellShares: attributedRaw,
    pmShares: fillShares,
  });
  const closed = remainingAfter <= 0;
  const attributed = closed && fillShares > 0 ? round4(fillShares) : attributedRaw;
  const stakeLeftUsdc = closed ? 0 : round4(Math.max(0, costUsdc - costPortion));
  const prevProceedsUsdc = Number(buy.pmSellProceeds);
  const nextProceedsUsdc = round4(
    (Number.isFinite(prevProceedsUsdc) && prevProceedsUsdc > 0 ? prevProceedsUsdc : 0) + proceedsUsdc,
  );
  const buyPatch: VenueOrder = {
    ...buy,
    pmOrigin: "changmen",
    pmSide: "buy",
    pmAttributedSellShares: attributed,
    pmSellState: closed ? "closed" : "partial",
    pmStakeUsdc: stakeLeftUsdc,
    // 原始买入本金不改；剩余敞口只看 pmStakeUsdc / 剩余份额
    betMoney: originalBetMoney,
    money: prevRealizedCny + profitCny,
    pmRealizedPnlUsdc: round4(prevRealizedUsdc + profitUsdc),
    // 回款真相在买单（对标 PF pfSellProceeds）；卖单 betMoney 仍为 CNY 镜像
    pmSellProceeds: nextProceedsUsdc,
    pmLastSellOrderId: sellOrderId,
    status: "none",
    // Phase 1：仓位事件审计镜像（服务端按 id 幂等合并；不覆盖 money 重算）
    positionEvents: {
      sells: [{
        id: sellOrderId,
        at: createAt,
        shares: deduct,
        price: fillPrice,
        proceeds: proceedsUsdc,
        pnl: profitUsdc,
        origin: "changmen" as const,
      }],
    },
  };

  return [buyPatch, sell];
}

/** 单测 / 调试：手动卖出后的买卖补丁 */
export { buildSellAndBuyPatchOrders };

function normalizeManualSellBuy(buyRow: OrderRowLike | VenueOrder): VenueOrder {
  return "provider" in buyRow && "orderId" in buyRow
    ? buyRow as VenueOrder
    : venueOrderFromOrderRow(buyRow);
}

function buildFilledOutcome(params: {
  account: PlatformAccount;
  buy: VenueOrder;
  sellOrderId: string;
  sharesSold: number;
  proceedsUsdc: number;
  fallbackPrice: number;
  sharesWanted: number;
}): Extract<PolymarketManualSellFinalOutcome, { outcome: "filled" }> {
  const fillPriceRaw = params.proceedsUsdc / params.sharesSold;
  const fillPrice = fillPriceRaw > 0 && fillPriceRaw < 1
    ? round4(fillPriceRaw)
    : (params.fallbackPrice > 0 && params.fallbackPrice < 1 ? round4(params.fallbackPrice) : round4(fillPriceRaw));
  markPolymarketChangmenOrder(params.account.accountId, params.sellOrderId);
  const ordersToSave = buildSellAndBuyPatchOrders({
    buy: { ...params.buy, provider: PLATFORMS.Polymarket },
    sellOrderId: params.sellOrderId,
    sharesSold: params.sharesSold,
    proceedsUsdc: params.proceedsUsdc,
    fillPrice,
    createAt: Date.now(),
  });
  return {
    outcome: "filled",
    sellOrderId: params.sellOrderId,
    sharesSold: params.sharesSold,
    proceedsUsdc: params.proceedsUsdc,
    fillPrice,
    ordersToSave,
    partialFill: params.sharesSold + 0.05 < params.sharesWanted,
  };
}

/**
 * 按卖单号确认状态。只有明确 canceled/expired 才是 unfilled；
 * 本地轮询截止仍模糊时返回 pending，调用方必须继续锁定卖出入口。
 */
export async function awaitPolymarketManualSellFinalOutcome(params: {
  account: PlatformAccount;
  buyRow: OrderRowLike | VenueOrder;
  sellOrderId: string;
  postResponse?: {
    makingAmount?: string | number;
    takingAmount?: string | number;
    status?: string;
  } | null;
  /** 限价兜底（无成交价时用） */
  fallbackPrice?: number;
  sharesWanted?: number;
}): Promise<PolymarketManualSellFinalOutcome> {
  const attempt = pmSubmitAttemptForOrder(params.account, params.sellOrderId);
  let recoveredEvidence = attempt?.evidence;
  if (attempt && !params.postResponse && ["dispatching", "submit_unknown"].includes(attempt.state)) {
    const recovered = await recoverPmUnknownSubmission(params.account, params.sellOrderId, "SELL", attempt.submittedAt);
    if (!recovered)
      return { outcome: "pending", sellOrderId: params.sellOrderId, reason: "卖出提交结果不确定，继续核对原单" };
    recoveredEvidence = recovered;
  }
  const sellOrderId = String(params.sellOrderId ?? "").trim();
  const buy = normalizeManualSellBuy(params.buyRow);
  const sharesWanted = params.sharesWanted && params.sharesWanted > 0
    ? params.sharesWanted
    : (resolvePmRemainingShares(buy) > 0.0001
      ? resolvePmRemainingShares(buy)
      : resolvePmFillShares(buy));
  const fallbackPrice = Number(params.fallbackPrice) || 0;

  if (!sellOrderId) {
    return { outcome: "unfilled", sellOrderId: "", reason: "缺少卖单号" };
  }

  const fromPost = parsePolymarketSellOrderFill(params.postResponse);
  if (fromPost.sharesSold > 0 && fromPost.proceedsUsdc > 0) {
    return buildFilledOutcome({
      account: params.account,
      buy,
      sellOrderId,
      sharesSold: fromPost.sharesSold,
      proceedsUsdc: fromPost.proceedsUsdc,
      fallbackPrice,
      sharesWanted,
    });
  }

  const recoveredShares = Number(recoveredEvidence?.trade?.size);
  const recoveredPrice = Number(recoveredEvidence?.trade?.price);
  if (recoveredShares > 0 && recoveredPrice > 0 && recoveredPrice < 1) {
    return buildFilledOutcome({ account: params.account, buy, sellOrderId,
      sharesSold: recoveredShares, proceedsUsdc: recoveredShares * recoveredPrice,
      fallbackPrice, sharesWanted });
  }

  const conditionId = String(buy.pmConditionId ?? "").trim();
  const delayInfo = conditionId
    ? await fetchPolymarketMarketSecondsDelay(conditionId)
    : { secondsDelay: UNKNOWN_SPORTS_SECONDS_DELAY, takerOrderDelayEnabled: false, fromMarket: false };
  const sd = delayInfo.fromMarket ? delayInfo.secondsDelay : UNKNOWN_SPORTS_SECONDS_DELAY;
  const poll = buildPolymarketDelayedPollOpts(sd);
  const watchTimeoutMs = buildPolymarketWatchTimeoutMs(sd);
  if (conditionId) {
    registerPolymarketOrderWatch(params.account, sellOrderId, {
      conditionId,
      timeoutMs: watchTimeoutMs,
    });
  }

  const tradeConfirm = {
    ...POLYMARKET_DELAYED_TRADE_CONFIRM_OPTS,
    maxRetries: Math.max(
      POLYMARKET_DELAYED_TRADE_CONFIRM_OPTS.maxRetries,
      poll.maxAttempts,
    ),
  };
  startPolymarketSettlementJob(params.account, sellOrderId, {
    side: "SELL",
    poll,
    tradeConfirm,
    conditionId: conditionId || undefined,
  });

  let settled = await awaitPolymarketSettlementJob(params.account, sellOrderId)
    ?? await settlePolymarketDelayedOrder(params.account, sellOrderId, {
      side: "SELL",
      poll,
      tradeConfirm,
    });
  if (interpretPolymarketOrderRow(recoveredEvidence?.row) === "matched"
    && interpretPolymarketOrderRow(settled.row) !== "matched")
    settled = { outcome: "matched", row: recoveredEvidence!.row };

  if (
    settled.outcome === "unfilled"
    && interpretPolymarketOrderRow(settled.row) === "unfilled"
  ) {
    return {
      outcome: "unfilled",
      sellOrderId,
      reason: "卖单未成交（FOK 已取消）",
    };
  }

  const resolved = await resolvePolymarketSellFillWithRetry(
    params.account,
    sellOrderId,
    params.postResponse,
    {
      lookbackMs: POLYMARKET_SELL_FILL_RETRY_OPTS.lookbackMs,
      retryMs: POLYMARKET_SELL_FILL_RETRY_OPTS.retryMs,
      maxRetries: Math.max(6, Math.ceil(poll.maxAttempts / 2)),
      orderRow: settled.row,
    },
  );

  if (resolved.sharesSold > 0 && resolved.proceedsUsdc > 0) {
    return buildFilledOutcome({
      account: params.account,
      buy,
      sellOrderId,
      sharesSold: resolved.sharesSold,
      proceedsUsdc: resolved.proceedsUsdc,
      fallbackPrice,
      sharesWanted,
    });
  }

  // 有份数无回款：用限价 / 买单成交价估算回款，仍算成交终态（避免误判未成交导致双卖）
  const rowShares = polymarketShareCount(settled.row?.size_matched);
  const sharesSold = resolved.sharesSold > 0 ? resolved.sharesSold : rowShares;
  const estimatePrice = fallbackPrice > 0 && fallbackPrice < 1
    ? fallbackPrice
    : (Number(buy.pmFillPrice) > 0 && Number(buy.pmFillPrice) < 1 ? round4(Number(buy.pmFillPrice)) : 0);
  if (sharesSold > 0 && estimatePrice > 0) {
    const proceedsUsdc = resolved.proceedsUsdc > 0
      ? resolved.proceedsUsdc
      : round4(sharesSold * estimatePrice);
    if (proceedsUsdc > 0) {
      return buildFilledOutcome({
        account: params.account,
        buy,
        sellOrderId,
        sharesSold,
        proceedsUsdc,
        fallbackPrice: estimatePrice,
        sharesWanted,
      });
    }
  }

  // 截止后最终读一次 order 行
  const lastRow = settled.row ?? await fetchPolymarketOrderRow(params.account, sellOrderId);
  const lastState = interpretPolymarketOrderRow(lastRow);
  if (lastState === "matched" || settled.outcome === "matched") {
    const matchedShares = polymarketShareCount(lastRow?.size_matched) || sharesSold;
    if (matchedShares > 0 && estimatePrice > 0) {
      return buildFilledOutcome({
        account: params.account,
        buy,
        sellOrderId,
        sharesSold: matchedShares,
        proceedsUsdc: round4(matchedShares * estimatePrice),
        fallbackPrice: estimatePrice,
        sharesWanted,
      });
    }
    // 已 matched 但无价可估：仍不得判 unfilled（防双卖）；用 dust 回款占位落库
    if (matchedShares > 0) {
      return buildFilledOutcome({
        account: params.account,
        buy,
        sellOrderId,
        sharesSold: matchedShares,
        proceedsUsdc: round4(matchedShares * 0.01),
        fallbackPrice: 0.01,
        sharesWanted,
      });
    }
  }
  if (lastState === "unfilled") {
    return {
      outcome: "unfilled",
      sellOrderId,
      reason: "卖单未成交（FOK 已取消）",
    };
  }

  // 截止仍模糊且无 matched 证据：保持待确认，绝不能重新开放卖出造成双卖。
  return {
    outcome: "pending",
    sellOrderId,
    reason: "卖单结果仍待场馆确认",
  };
}

/**
 * [changmen 扩展] 手动卖 delayed：与买单对齐——按 conditionId 拉 `sd`、
 * User WS watch + settlement job（SELL），再补齐 shares/USDC。
 */
export async function confirmPolymarketManualSellDelayedFill(params: {
  account: PlatformAccount;
  sellOrderId: string;
  conditionId: string;
  postResponse: {
    makingAmount?: string | number;
    takingAmount?: string | number;
  } | null | undefined;
}): Promise<{ sharesSold: number; proceedsUsdc: number }> {
  const final = await awaitPolymarketManualSellFinalOutcome({
    account: params.account,
    buyRow: {
      provider: PLATFORMS.Polymarket,
      orderId: "",
      odds: 0,
      createAt: Date.now(),
      betMoney: 0,
      reward: 0,
      money: 0,
      status: "none",
      game: "",
      match: "",
      bet: "",
      item: "",
      pmConditionId: params.conditionId,
      pmSide: "buy",
      pmSellState: "open",
    },
    sellOrderId: params.sellOrderId,
    postResponse: params.postResponse,
  });
  if (final.outcome !== "filled")
    throw new Error(final.reason || "卖单延迟撮合未确认成交");
  return { sharesSold: final.sharesSold, proceedsUsdc: final.proceedsUsdc };
}

/**
 * 按指令卖出当前买单剩余份额（FOK），并返回成交结果（含仅本买单的落库 patch）。
 * 一旦拿到 sellOrderId，会 await 到 filled/unfilled 终态。
 */
export async function sellPolymarketBuyPosition(params: {
  account: PlatformAccount;
  buyRow: OrderRowLike | VenueOrder;
  /** 卖单已受理（有 orderId）时回调，供 UI 进入「平仓中」 */
  onSubmitted?: (info: {
    sellOrderId: string;
    fallbackPrice: number;
    sharesWanted: number;
  }) => void;
}): Promise<PolymarketManualSellResult> {
  const buy = normalizeManualSellBuy(params.buyRow);

  if (String(buy.provider) !== "Polymarket" && String((params.buyRow as OrderRowLike).Type ?? "") !== "Polymarket")
    return { ok: false, error: "非 Polymarket 订单" };
  if (buy.pmSide === "sell")
    return { ok: false, error: "卖单不可再卖" };
  if (!hasOpenPolymarketPosition(buy) && resolvePmRemainingShares(buy) <= 0.0001)
    return { ok: false, error: "该买单已无剩余份额" };

  const tokenId = String(buy.pmTokenId ?? "").trim();
  if (!tokenId)
    return { ok: false, error: "缺少 pmTokenId" };

  const sharesWanted = resolvePmRemainingShares(buy) > 0.0001
    ? resolvePmRemainingShares(buy)
    : resolvePmFillShares(buy);
  if (!(sharesWanted > 0))
    return { ok: false, error: "该买单份额无效" };

  const config = parseTokenConfig(params.account.token);
  const creds = resolveApiCreds(config);
  const privateKey = resolvePrivateKey(config);
  if (!creds.address)
    return { ok: false, error: "凭证缺少 walletAddress" };
  if (!privateKey)
    return { ok: false, error: "缺少有效私钥：请先解锁本机钱包，或重新导入私钥" };
  if (!creds.apiKey || !creds.secret || !creds.passphrase)
    return { ok: false, error: "凭证缺少用户 API Key" };

  const gateway = params.account.gateway || POLYMARKET_CLOB_API;

  let submittedSellOrderId = "";
  let sellLimitPrice = 0;
  try {
    const submitMode = resolvePmOrderSubmitHttpMode();
    const signingGeneration = polymarketSigningGeneration();
    const accountBinding = JSON.stringify([params.account.accountId, params.account.gateway, params.account.token]);
    const [book] = await Promise.all([
      pmGetBook<PolymarketOrderBookResponse>(tokenId, gateway),
      pmPrepareSubmit(params.account),
    ]);
    const bids = parseBidsFromBook(book);
    const { tickSize, minOrderSize, negRisk, version } = polymarketMarketOrderOptions(book, tokenId);

    const estimated = estimatePolymarketSellProceedsUsdc(bids, sharesWanted);
    if (!(estimated > 0))
      throw new Error("bids 深度不足以全卖该买单份额");

    const price = calculateSellMarketLimitPrice(bids, sharesWanted, minOrderSize);
    if (!isPolymarketPriceOnTick(price, tickSize)) throw new Error("PM 卖出限价不符合盘口 tick");
    sellLimitPrice = price;
    const orderBody = await createPolymarketFokSellOrderBody(
      gateway,
      privateKey,
      creds,
      config,
      tokenId,
      price,
      sharesWanted,
      { tickSize, negRisk, version },
    );
    if (resolvePmOrderSubmitHttpMode() !== submitMode)
      throw new Error("PM 下单方式已改变，请重新卖出");
    if (polymarketSigningGeneration() !== signingGeneration
      || JSON.stringify([params.account.accountId, params.account.gateway, params.account.token]) !== accountBinding)
      throw new Error("PM 账号或钱包会话已改变，请重新卖出");
    if (!pmSubmitClockReady(params.account))
      throw new Error("PM 提交校时未就绪，请重新卖出");
    const result = await guardedPmSubmit(params.account, orderBody,
      { version, negRisk, parentBuyId: String(buy.orderId), validateBeforeDispatch: () => {
        if (polymarketSigningGeneration() !== signingGeneration
          || JSON.stringify([params.account.accountId, params.account.gateway, params.account.token]) !== accountBinding)
          throw new Error("PM 账号或钱包会话已改变，请重新卖出");
        if (!pmSubmitClockReady(params.account)) throw new Error("PM 提交校时未就绪，请重新卖出");
      } },
      () => pmSubmitOrder<PolymarketOrderResponse>(params.account, orderBody));
    const sellOrderId = String(result?.orderID ?? "").trim();
    submittedSellOrderId = sellOrderId;
    if (!result?.success || !sellOrderId) {
      throw new Error(String(result?.errorMsg ?? "FOK 卖单未受理").trim() || "FOK 卖单未受理");
    }

    markPolymarketChangmenOrder(params.account.accountId, sellOrderId);

    try {
      params.onSubmitted?.({
        sellOrderId,
        fallbackPrice: price,
        sharesWanted,
      });
    }
    catch { /* UI 回调失败不阻断确认 */ }

    const final = await awaitPolymarketManualSellFinalOutcome({
      account: params.account,
      buyRow: buy,
      sellOrderId,
      postResponse: result,
      fallbackPrice: price,
      sharesWanted,
    });

    if (final.outcome === "unfilled") {
      finishPmSubmitAttempt(params.account, sellOrderId);
      return {
        ok: false,
        error: final.reason,
        sellOrderId,
        unfilled: true,
        chainSubmitted: false,
      };
    }
    if (final.outcome === "pending") {
      return {
        ok: false,
        error: final.reason,
        sellOrderId,
        pending: true,
        chainSubmitted: true,
      };
    }

    return {
      ok: true,
      sellOrderId: final.sellOrderId,
      sharesSold: final.sharesSold,
      fillPrice: final.fillPrice,
      proceedsUsdc: final.proceedsUsdc,
      pending: false,
      ordersToSave: final.ordersToSave,
      partialFill: final.partialFill,
    };
  }
  catch (err) {
    if (err instanceof PmSubmitUnknownError) {
      if (err.attempt.parentBuyId !== String(buy.orderId))
        return { ok: false, error: "同资产的另一张买单仍在平仓确认中，请等待原单完成", unfilled: true };
      const lookupId = err.attempt.acceptedOrderId || err.attempt.orderHash;
      // 让现有平仓续查持有查询哈希；它不属于官方 ACK。
      try { params.onSubmitted?.({ sellOrderId: lookupId,
        fallbackPrice: Number(err.attempt.takerAmount) / Number(err.attempt.makerAmount),
        sharesWanted: Number(err.attempt.makerAmount) / 1e6 }); } catch { /* UI 不影响原单 */ }
      return { ok: false, error: err.message, sellOrderId: lookupId,
        pending: true, pmSubmitUnknown: !err.attempt.acceptedOrderId,
        unfilled: false, chainSubmitted: Boolean(err.attempt.acceptedOrderId) };
    }
    // 已受理但确认过程抛错：再跑一遍终态，保证不卡在模糊态
    if (submittedSellOrderId) {
      try {
        const final = await awaitPolymarketManualSellFinalOutcome({
          account: params.account,
          buyRow: buy,
          sellOrderId: submittedSellOrderId,
          fallbackPrice: sellLimitPrice > 0 ? sellLimitPrice : undefined,
          sharesWanted,
        });
        if (final.outcome === "filled") {
          return {
            ok: true,
            sellOrderId: final.sellOrderId,
            sharesSold: final.sharesSold,
            fillPrice: final.fillPrice,
            proceedsUsdc: final.proceedsUsdc,
            pending: false,
            ordersToSave: final.ordersToSave,
            partialFill: final.partialFill,
          };
        }
        if (final.outcome === "pending") {
          return {
            ok: false,
            error: final.reason,
            sellOrderId: submittedSellOrderId,
            pending: true,
            chainSubmitted: true,
          };
        }
        return {
          ok: false,
          error: final.reason,
          sellOrderId: submittedSellOrderId,
          unfilled: true,
        };
      }
      catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      sellOrderId: submittedSellOrderId || undefined,
      chainSubmitted: Boolean(submittedSellOrderId),
      unfilled: !submittedSellOrderId,
    };
  }
}

