import type { AccountBalanceResult, PlatformProvider, ResolveLegOutcomeOpts } from "../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { resolvePolymarketVenueStakeUsdc } from "./pmStake";
import { currentPmTick } from "./pmTickState";
import { validatePmPriceQuote, type PmPriceQuote } from "./priceQuote";
import { validatePmTickBufferQuote, notePmTickBufferBook, pmTickBufferTick, type PmTickBufferQuote } from "./pmTickBuffer";
import { pmBuyOrderShares } from "./pmBuyOrderShares";
import { resolvePmHttpMode } from "./pmTransportMode";
import { resolvePmOrderSubmitHttpMode } from "./pmOrderSubmitMode";
import { getPmMarketWsSourceMode } from "./pmMarketWsMode";
import { POLYMARKET_CLOB_API } from "./api";
import { resolvePolymarketBuilderCode } from "./builder";
import {
  buildL2HeadersFromAccount,
  parseTokenConfig,
  resolveApiCreds,
  resolveFunder,
  resolvePrivateKey,
  resolveSignatureType,
} from "./l2Auth";
import {
  fetchPolymarketVenueOrdersMerged,
} from "./orders";
import { markPolymarketChangmenOrder } from "./pmOrigin";
import { bumpPolymarketOrderSyncAfterBet } from "./pmOrderSync";
import { registerPolymarketOrderWatch, warmPolymarketUserWs } from "./userWs";
import { tracePolymarketOrder } from "./orderTrace";
import { startPolymarketSettlementJob } from "./settlementJob";
import {
  UNKNOWN_SPORTS_SECONDS_DELAY,
  buildPolymarketDelayedPollOpts,
  buildPolymarketWatchTimeoutMs,
  fetchPolymarketMarketSecondsDelay,
} from "./marketDelay";
import { resolvePolymarketProviderLegOutcome } from "./legOutcome";
import { resolvePolymarketBetBlockReason } from "./pmBetGuard";
import {
  isPolymarketSubmitTimeoutError,
  isPolymarketTradingDisabledError,
  POLYMARKET_SUBMIT_TIMEOUT_MESSAGE,
  POLYMARKET_TRADING_DISABLED_MESSAGE,
} from "./pmMarketGuard";
import { getPolymarketPmSportBlockReasonFromOption } from "./pmSportGuard";
import {
  isValidClobPrice,
  resolvePolymarketDetectionMaxPrice,
  type PolymarketOptionQuoteData,
} from "./pmDetection";
import {
  isPolymarketPriceAboveDetectionError,
  PolymarketPriceAboveDetectionError,
  syncPolymarketFoOnPriceAboveDetection,
} from "./pmTokenQuote";
import {
  isPolymarketPriceOnTick,
  alignPolymarketPriceToTick,
  type PolymarketTickSize,
} from "./pmTickPrice";
import { resolvePolymarketVenueIdentityFromToken } from "./profile";
import { polymarketPluginGet } from "./transport";
import { pmSubmitClockReady, pmPrepareSubmit, pmGetBook, pmSubmitOrder } from "./pmClientApi";
import { polymarketMarketOrderOptions } from "./pmMarketOrderOptions";
import { guardedPmSubmit, PmSubmitUnknownError, finishPmSubmitAttempt } from "./pmSubmitJournal";
import { measurePmExecution, recordPmExecutionMetric } from "./pmExecutionMetrics";
import {
  getPolymarketOrderClientRuntime,
  polymarketSigningGeneration,
  type PolymarketOrderClientRuntime,
} from "./pmOrderClientCache";
import {
  pmFokDepthReuseMultiplier,
  getPmFokDepthBufferPrefs,
  pmFokDepthBufferNeedUsdc,
  pmFokFillPriceDepthUsdc,
} from "./pmFokDepthBufferMode";

export { isPolymarketDelayedPending } from "./orderStatus";
export {
  fetchPolymarketOrderRow,
  formatPolymarketSettlementMessage,
  pollPolymarketDelayedOrder,
} from "./orderStatus";
export { settlePolymarketDelayedOrder } from "./orderSettlement";
export {
  awaitPolymarketSettlementJob,
  clearPolymarketSettlementJobs,
  startPolymarketSettlementJob,
} from "./settlementJob";

const BALANCE_PATH = "/balance-allowance";

const COLLATERAL_DECIMALS = 1_000_000;
type TickSize = PolymarketTickSize;

interface PolymarketBalanceAllowanceResponse {
  balance?: string | number;
  allowance?: string | number;
}

interface PolymarketOrderResponse {
  pmSubmitNotSent?: boolean;
  success?: boolean;
  error?: string;
  errorMsg?: string;
  orderID?: string;
  status?: string;
  makingAmount?: string;
  takingAmount?: string;
  transactionsHashes?: string[];
  tradeIDs?: string[];
}

/** FOK BUY 成交：对齐 Polymarket 文档与官网仓位（status=matched 且 takingAmount>0） */
export function isPolymarketFokBuyFilled(result: PolymarketOrderResponse | null | undefined): boolean {
  if (!result?.success)
    return false;
  const status = String(result.status ?? "").trim().toLowerCase();
  if (status !== "matched")
    return false;
  const taking = Number(result.takingAmount);
  return Number.isFinite(taking) && taking > 0;
}

/** CLOB 已受理：含 delayed（链上延迟成交，勿重复 submit） */
export function isPolymarketOrderAccepted(result: PolymarketOrderResponse | null | undefined): boolean {
  return result?.success === true && typeof result.orderID === "string" && result.orderID.trim().length > 0;
}

export function polymarketOrderFailureMessage(
  result: PolymarketOrderResponse | null | undefined,
  fallback: string,
): string {
  const status = String(result?.status ?? "").trim() || "未知";
  const errorMsg = String(result?.errorMsg ?? "").trim();
  const parts = [errorMsg || fallback, `status: ${status}`];
  if (result?.orderID)
    parts.push(`orderID: ${result.orderID}`);
  const taking = result?.takingAmount;
  if (taking !== undefined && taking !== "")
    parts.push(`takingAmount: ${taking}`);
  return parts.join(" / ");
}

interface PolymarketOrderBookResponse {
  error?: string;
  asset_id?: string;
  timestamp?: string | number;
  version?: string;
  tick_size?: string | number;
  minimum_tick_size?: string | number;
  min_order_size?: string | number;
  neg_risk?: boolean;
  asks?: Array<{ price?: string | number; size?: string | number }>;
}

// ---- official CLOB v2 order helpers ----

function resolveSdkSignatureType(value: string | number | undefined): number {
  const numeric = Number(value ?? 0);
  return [1, 2, 3].includes(numeric) ? numeric : 0;
}

function builderCodeMetric(): { builderCodePresent: boolean } {
  try {
    resolvePolymarketBuilderCode();
    return { builderCodePresent: true };
  }
  catch {
    return { builderCodePresent: false };
  }
}

export interface PolymarketOrderOptions {
  version: 2 | 3;
  bookTimestamp: number;
  tickSize: TickSize;
  minOrderSize: number;
  negRisk: boolean;
  asks: Array<{ price: number; size: number }>;
}

/** checkBet 写入、betting 可复用的 PM 买单预检缓存 */
export interface PolymarketBuyCheckData extends Record<string, unknown> {
  /** [changmen 扩展] 建腿时冻结的调整报价，预检和发单复用。 */
  pmPriceQuote?: PmPriceQuote;
  pmBufferMode?: "tick";
  pmTickQuote?: PmTickBufferQuote;
  tokenId: string;
  odds: number;
  detectionOdds: number;
  detectionMaxPrice: number;
  /** 与 detectionMaxPrice 相同；fo clobPrice 锁定值 */
  detectionClobPrice?: number;
  bookPrice: number;
  limitPrice: number;
  betMoney: number;
  apiBetMoney: number;
  side: "BUY";
  bookFetchedAt: number;
  orderOptions: PolymarketOrderOptions;
  /** 预检时的深度倍数（关=1）；复用 book 时须一致 */
  depthMultiplier?: number;
}

interface PreparedBuy {
  data: PolymarketBuyCheckData;
  runtime: PolymarketOrderClientRuntime | null;
  binding: string;
  generation: number;
  consumed: boolean;
  role: "execute" | "precheckOnly";
  readyAt: number;
  cacheHit: boolean;
}
function validatePreparedPrice(data: PolymarketBuyCheckData): void {
  if (data.pmPriceQuote) {
    const quote = validatePmPriceQuote(data.pmPriceQuote, data.tokenId, data.detectionOdds);
    if (quote.cap !== data.detectionMaxPrice || data.limitPrice > quote.cap + 1e-12)
      throw new Error("PM 调整报价冻结限价已改变");
  }
  // [changmen 扩展] 所有 BUY 尝试共用执行校验，包括等待提交锁后；只核验冻结限价，不重算报价。
  const latestTick = currentPmTick(data.tokenId, data.orderOptions.bookTimestamp);
  if (latestTick && !isPolymarketPriceOnTick(data.limitPrice, latestTick))
    throw new Error("PM tick 已改变，冻结限价不再有效");
  if (data.pmBufferMode !== "tick" && data.pmPriceQuote?.mode !== "tick") return;
  const quote = data.pmPriceQuote?.mode === "tick"
    ? data.pmPriceQuote : validatePmTickBufferQuote(data.pmTickQuote, data.tokenId, data.detectionOdds);
  if (data.pmBufferMode === "tick") validatePmTickBufferQuote(data.pmTickQuote, data.tokenId, data.detectionOdds);
  if (quote.cap !== data.limitPrice || quote.cap !== data.detectionMaxPrice)
    throw new Error("PM +1 tick 冻结限价已改变");
  if (quote.tick !== data.orderOptions.tickSize)
    throw new Error("PM tick 已改变，请新建投注尝试");
  const tick = currentPmTick(data.tokenId, data.orderOptions.bookTimestamp) ?? pmTickBufferTick(data.tokenId) ?? data.orderOptions.tickSize;
  if (tick !== data.orderOptions.tickSize)
    throw new Error("PM tick 已改变，请新建投注尝试");
}
const preparedBuys = new WeakMap<BetOption, PreparedBuy>();
const checkedOptions = new WeakSet<BetOption>();
const invalidatedChecks = new WeakSet<BetOption>();

function checkInputBinding(account: PlatformAccount, option: BetOption): string {
  // 钱包解锁可以补齐 token 中的私钥；行情、账号归属及路由参数须从预检入口保持一致。
  return JSON.stringify([account.accountId, account.gateway, account.currency,
    option.itemId, option.betId, option.betMoney, option.odds, option.data,
    option.target, option.type, option.matchId, pmFokDepthReuseMultiplier(),
    resolvePmHttpMode(), getPmMarketWsSourceMode(), resolvePmOrderSubmitHttpMode()]);
}

function preparationBinding(account: PlatformAccount, option: BetOption): string {
  // 凭据只保留在内存，不写入 option、日志或订单元数据。
  return JSON.stringify([account.accountId, account.gateway, account.token,
    resolvePrivateKey(parseTokenConfig(account.token)), resolvePolymarketBuilderCode(),
    resolvePmHttpMode(), getPmMarketWsSourceMode(), resolvePmOrderSubmitHttpMode(), option.itemId, option.betId,
    option.betMoney, option.odds, option.target, option.type, option.matchId, account.currency, pmFokDepthReuseMultiplier()]);
}

/** [changmen 扩展] 双腿发单前可同步核验；不拉簿、不重新定价、不消费。 */
export function validatePolymarketPreparedBuy(account: PlatformAccount, option: BetOption): string | null {
  const prepared = preparedBuys.get(option);
  if (!prepared || prepared.data !== option.data) return "PM 缺少本轮预检结果";
  if (prepared.consumed) return "PM 本轮预检结果已消费";
  if (prepared.role !== "execute" || !prepared.runtime) return "PM 此腿仅预检";
  if (option.checkError) return option.checkError;
  if (!pmSubmitClockReady(account)) return "PM 提交校时准备已失效";
  if (prepared.generation !== polymarketSigningGeneration()) return "PM 钱包会话已失效";
  try { validatePreparedPrice(prepared.data); }
  catch (err) { return err instanceof Error ? err.message : "PM 冻结报价失效"; }
  try {
    if (prepared.binding !== preparationBinding(account, option)) return "PM 下单参数或账号已改变，请新建尝试";
  } catch { return "PM 签名准备已失效"; }
  return null;
}

/** BUY FOK 限价打在检测上限（向下对齐 tick），不是当前卖一 */
function polymarketFokLimitFromDetection(
  maxPrice: number,
  tickSize: TickSize,
  fillPrice: number,
): number {
  const aligned = alignPolymarketPriceToTick(maxPrice, tickSize, "floor");
  const limit = fillPrice > aligned + 1e-12 ? fillPrice : aligned;
  if (!isValidClobPrice(limit) || !isPolymarketPriceOnTick(limit, tickSize) || limit > maxPrice + 1e-12)
    throw new Error(`无效检测价 ${maxPrice}（tick ${tickSize}）`);
  return limit;
}

interface PolymarketOrderDiagnostic {
  tokenId: string;
  amountUsdc: number;
  displayedOdds: number;
  displayedPrice: number;
  limitPrice?: number;
  minOrderSize: number;
  shares?: number;
  availableUsdc: number;
  asks: PolymarketOrderOptions["asks"];
}

function polymarketSubmitCatchMessage(err: unknown): string {
  if (isPolymarketTradingDisabledError(err))
    return POLYMARKET_TRADING_DISABLED_MESSAGE;
  if (isPolymarketSubmitTimeoutError(err) || /network error/i.test(err instanceof Error ? err.message : String(err)))
    return POLYMARKET_SUBMIT_TIMEOUT_MESSAGE;
  return err instanceof Error ? err.message : String(err);
}

async function fetchOrderOptions(gateway: string, tokenId: string): Promise<PolymarketOrderOptions> {
  const book = await pmGetBook<PolymarketOrderBookResponse>(tokenId, gateway);
  if (isPolymarketTradingDisabledError(book))
    throw new Error(POLYMARKET_TRADING_DISABLED_MESSAGE);
  const market = polymarketMarketOrderOptions(book, tokenId);
  if (!Array.isArray(book.asks))
    throw new Error("PM 订单簿结构、资产或版本无效");
  const bookTimestamp = Number(book.timestamp) || 0;
  const bookTick = market.tickSize;
  const tickSize = currentPmTick(tokenId, bookTimestamp) ?? bookTick;
  return {
    version: market.version,
    bookTimestamp,
    tickSize,
    minOrderSize: Number(book?.min_order_size) || 0,
    negRisk: Boolean(book?.neg_risk),
    asks: (book?.asks ?? [])
      .map(level => ({
        price: Number(level.price),
        size: Number(level.size),
      }))
      .filter(level =>
        Number.isFinite(level.price) &&
        Number.isFinite(level.size) &&
        level.price > 0 &&
        level.price < 1 &&
        level.size > 0,
      )
      .sort((a, b) => a.price - b.price),
  };
}

function fmt(value: number, decimals = 4): string {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)).toString() : "N/A";
}

function asksPreview(asks: PolymarketOrderOptions["asks"]): string {
  if (!asks.length)
    return "无 asks 卖单";
  return asks.slice(0, 5)
    .map((level, index) => `${index + 1}. ${fmt(level.price, 4)} x ${fmt(level.size, 2)} = ${fmt(level.price * level.size, 2)} USDC`)
    .join("\n");
}

function availableUsdc(asks: PolymarketOrderOptions["asks"]): number {
  return asks.reduce((sum, level) => sum + level.price * level.size, 0);
}

function availableUsdcAtPrice(
  asks: PolymarketOrderOptions["asks"],
  maxPrice: number,
): number {
  return availableUsdc(asks.filter(level => level.price <= maxPrice + 1e-9));
}

/** [changmen 扩展] 开：1× 成交价 P 及更优须 ≥ 本金×倍数。关：原 1×。 */
function assertPmFokDepthAtFillPrice(
  bookAsks: PolymarketOrderOptions["asks"],
  amountUsdc: number,
  fillPrice: number,
): void {
  const need = pmFokDepthBufferNeedUsdc(amountUsdc);
  if (need == null)
    return;
  const available = pmFokFillPriceDepthUsdc(bookAsks, fillPrice);
  if (available + 1e-9 >= need)
    return;
  const { multiplier } = getPmFokDepthBufferPrefs();
  throw new Error([
    "Polymarket FOK 盘口深度不足",
    `- 需要 ${fmt(need, 2)} USDC（金额 ${fmt(amountUsdc, 2)} × ${multiplier}）`,
    `- 成交价 ${fmt(fillPrice, 4)} 及更优可立即成交约 ${fmt(available, 2)} USDC`,
  ].join("\n"));
}

function diagnosticLines(diag: PolymarketOrderDiagnostic): string[] {
  const bestAsk = diag.asks[0];
  const lines = [
    "【订单】",
    `- 金额：${fmt(diag.amountUsdc, 2)} USDC`,
    `- 页面赔率：${fmt(diag.displayedOdds, 4)}（价格 ${fmt(diag.displayedPrice, 4)}）`,
    `- tokenId：${diag.tokenId}`,
    "",
    "【盘口】",
    bestAsk
      ? `- 最佳卖价：${fmt(bestAsk.price, 4)}（赔率 ${fmt(1 / bestAsk.price, 4)}），数量 ${fmt(bestAsk.size, 2)}`
      : "- 最佳卖价：无",
    `- 可立即成交：${fmt(diag.availableUsdc, 2)} USDC`,
    `- 最小下单份数：${diag.minOrderSize || "未知"}`,
    "- 前 5 档 asks：",
    asksPreview(diag.asks),
  ];
  if (diag.limitPrice) {
    lines.splice(4, 0, `- FOK 限价：${fmt(diag.limitPrice, 4)}（赔率 ${fmt(1 / diag.limitPrice, 4)}）`);
  }
  if (diag.shares !== undefined) {
    lines.splice(diag.limitPrice ? 5 : 4, 0, `- 预计买入：${fmt(diag.shares, 4)} 份`);
  }
  return lines;
}

async function resolvePolymarketExecutableBuy(
  gateway: string,
  tokenId: string,
  detectionOdds: number,
  apiBetMoney: number,
  maxPrice: number,
): Promise<{
  price: number;
  bookOdds: number;
  orderOptions: PolymarketOrderOptions;
  bookFetchedAt: number;
  depthAvailableAtCap: number;
  depthNeedUsdc?: number;
}> {
  if (!maxPrice || maxPrice <= 0 || maxPrice >= 1)
    throw new Error(`无效检测价 ${maxPrice}（赔率 ${detectionOdds}）`);
  const orderOptions = await fetchOrderOptions(gateway, tokenId);
  const price = calculateBuyMarketLimitPrice(
    orderOptions.asks,
    apiBetMoney,
    orderOptions.minOrderSize,
    {
      tokenId,
      amountUsdc: apiBetMoney,
      displayedOdds: detectionOdds,
      displayedPrice: maxPrice,
      minOrderSize: orderOptions.minOrderSize,
    },
    maxPrice,
  );
  return {
    price,
    // 与 fo / 页面 / 建腿同源：trunc3(1/price)，不用 round4
    bookOdds: truncateOddsTo3(1 / price),
    orderOptions,
    bookFetchedAt: Date.now(),
    depthAvailableAtCap: availableUsdcAtPrice(orderOptions.asks, maxPrice),
    depthNeedUsdc: pmFokDepthBufferNeedUsdc(apiBetMoney) ?? apiBetMoney,
  };
}

function calculateBuyMarketLimitPrice(
  asks: PolymarketOrderOptions["asks"],
  amountUsdc: number,
  minOrderSize: number,
  diagnostic: Omit<PolymarketOrderDiagnostic, "availableUsdc" | "asks">,
  maxPrice?: number,
): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0)
    throw new Error(`无效买入金额 ${amountUsdc}`);
  const bookAsks = maxPrice != null
    ? asks.filter(level => level.price <= maxPrice + 1e-9)
    : asks;
  const baseDiag = {
    ...diagnostic,
    availableUsdc: availableUsdc(bookAsks),
    asks: bookAsks,
  };
  if (maxPrice != null && !bookAsks.length) {
    const best = asks[0];
    const message = [
      "Polymarket 盘口价高于检测价，预检不通过",
      ...diagnosticLines({
        ...baseDiag,
        availableUsdc: availableUsdc(asks),
        asks,
      }),
      "",
      "【说明】",
      best
        ? `- 最佳卖价 ${fmt(best.price, 4)}（赔率 ${fmt(1 / best.price, 4)}）高于检测价 ${fmt(maxPrice, 4)}（赔率 ${fmt(diagnostic.displayedOdds, 4)}）`
        : "- 盘口无卖单",
      "- 不会在高于套利检测价的位置 FOK 成交。",
    ].join("\n");
    if (best && Number.isFinite(best.price) && best.price > 0 && best.price < 1)
      throw new PolymarketPriceAboveDetectionError(message, best.price, maxPrice);
    throw new Error(message);
  }
  let remaining = amountUsdc;
  for (const level of bookAsks) {
    const notional = level.price * level.size;
    if (notional >= remaining) {
      const shares = amountUsdc / level.price;
      if (minOrderSize > 0 && shares < minOrderSize) {
        const minAmount = minOrderSize * level.price;
        throw new Error([
          "Polymarket 下单金额低于最小份数",
          ...diagnosticLines({ ...baseDiag, limitPrice: level.price, shares }),
          "",
          "【建议】",
          `- 当前盘口至少约 ${fmt(minAmount, 2)} USDC 才能买满 ${minOrderSize} 份。`,
        ].join("\n"));
      }
      assertPmFokDepthAtFillPrice(bookAsks, amountUsdc, level.price);
      return level.price;
    }
    remaining -= notional;
  }
  throw new Error([
    "Polymarket FOK 盘口深度不足",
    ...diagnosticLines(baseDiag),
    "",
    "【说明】",
    "- FOK 要求整笔金额立即成交，否则整单取消。",
  ].join("\n"));
}

async function createPolymarketOrderBody(
  runtime: PolymarketOrderClientRuntime,
  apiKey: string,
  data: PolymarketBuyCheckData,
) {
  const { builder, clob, builderCode } = runtime;
  const signedOrder = await builder.buildMarketOrder({
    tokenID: data.tokenId, price: data.limitPrice, amount: data.apiBetMoney,
    side: clob.Side.BUY, builderCode,
  }, { tickSize: data.orderOptions.tickSize, negRisk: data.orderOptions.negRisk } as any,
  data.orderOptions.version);
  if (!clob.isV2Order(signedOrder)) throw new Error("Polymarket SDK 未生成受支持订单");
  if (Number(signedOrder.takerAmount) / 1_000_000 < data.orderOptions.minOrderSize)
    throw new Error("Polymarket 下单金额低于最小份数（实际签单限价）");
  return clob.orderToJsonV2(signedOrder, apiKey, clob.OrderType.FOK, false, false);
}

// ---- balance helpers ----

function balanceQueryPathForSignature(signatureType: string | number | undefined): string {
  const params = new URLSearchParams({ asset_type: "COLLATERAL" });
  if (signatureType !== undefined && signatureType !== "")
    params.set("signature_type", String(signatureType));
  return `${BALANCE_PATH}?${params.toString()}`;
}

function parseCollateralBalance(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value / COLLATERAL_DECIMALS : undefined;
}

/** 下单 USDC：仅以 option.betMoney（场馆口径）为准；禁止回退 data.apiBetMoney */
function resolvePolymarketApiBetMoney(_account: PlatformAccount, option: BetOption): number {
  return resolvePolymarketVenueStakeUsdc(option.betMoney);
}

// ---- provider ----

export const polymarketProvider: PlatformProvider = {
  async getBalance(account: PlatformAccount): Promise<AccountBalanceResult | undefined> {
    try {
      const config = parseTokenConfig(account.token);
      const gateway = account.gateway || POLYMARKET_CLOB_API;
      const requestPath = balanceQueryPathForSignature(resolveSignatureType(config));
      const url = `${gateway}${requestPath}`;
      // accountId=0：保存前探测，RDS 尚无账号，走客户端 L2 头（不经 relay 查库）
      let data: PolymarketBalanceAllowanceResponse | undefined;
      if (account.accountId) {
        data = await polymarketPluginGet<PolymarketBalanceAllowanceResponse>(url, {
          account,
          l2Path: BALANCE_PATH,
        });
      }
      else {
        const headers = await buildL2HeadersFromAccount(account, "GET", BALANCE_PATH);
        if (!headers)
          return undefined;
        data = await polymarketPluginGet<PolymarketBalanceAllowanceResponse>(url, { headers });
      }
      const balance = parseCollateralBalance(data?.balance);
      if (balance === undefined) return undefined;
      const out: AccountBalanceResult = {
        balance,
        currency: "USDT",
      };
      try {
        const identity = await resolvePolymarketVenueIdentityFromToken(account.token);
        if (identity?.venueMemberId)
          out.venueMemberId = identity.venueMemberId;
        if (identity?.venueAccountName)
          out.venueAccountName = identity.venueAccountName;
      }
      catch {
        /* 资料失败不阻断余额 */
      }
      return out;
    } catch (err) {
      console.warn("[Polymarket] getBalance failed", err);
      return undefined;
    }
  },

  async getOrders(account: PlatformAccount) {
    try {
      return await fetchPolymarketVenueOrdersMerged(account);
    }
    catch (err) {
      console.warn("[Polymarket] getOrders failed", err);
      return [];
    }
  },

  resolveLegOutcome(account, result, opts?: ResolveLegOutcomeOpts) {
    return resolvePolymarketProviderLegOutcome(
      acc => fetchPolymarketVenueOrdersMerged(acc),
      account,
      result,
      opts,
    );
  },

  async checkBet(account: PlatformAccount, option: BetOption, context): Promise<BetOption> {
    if (checkedOptions.has(option) || (option.data?.side === "BUY" && option.data?.orderOptions)) {
      invalidatedChecks.add(option);
      preparedBuys.delete(option);
      option.data = null;
      option.checkError = "PM 每次预检须新建投注尝试";
      return option;
    }
    checkedOptions.add(option);
    option.checkError = undefined;
    const checkStartedAt = performance.now();
    const localBlock = getPolymarketPmSportBlockReasonFromOption(option);
    if (localBlock) {
      option.checkError = localBlock;
      option.data = null;
      recordPmExecutionMetric({
        kind: "check",
        tokenId: option.itemId,
        accountId: Number(account.accountId) || undefined,
        ms: performance.now() - checkStartedAt,
        success: false,
        error: localBlock,
      });
      return option;
    }

    const prior = option.data as PolymarketOptionQuoteData | PolymarketBuyCheckData | null | undefined;
    const tickQuoteData = prior as Partial<PolymarketBuyCheckData> | undefined;
    let priceQuote: PmPriceQuote | undefined;
    if (tickQuoteData?.pmPriceQuote) {
      try {
        priceQuote = Object.freeze({ ...validatePmPriceQuote(tickQuoteData.pmPriceQuote, option.itemId, Number(prior?.detectionOdds ?? option.odds)) });
        if (tickQuoteData.detectionMaxPrice !== priceQuote.cap || option.odds !== priceQuote.displayOdds)
          throw new Error("PM 调整检测价已改变");
      } catch (err) {
        option.checkError = err instanceof Error ? err.message : String(err);
        option.data = null;
        return option;
      }
    }
    let tickQuote: PmTickBufferQuote | undefined = priceQuote?.mode === "tick" ? priceQuote : undefined;
    if (tickQuoteData?.pmBufferMode === "tick") {
      try {
        const legacyQuote = validatePmTickBufferQuote(tickQuoteData.pmTickQuote, option.itemId, Number(prior?.detectionOdds ?? option.odds));
        if (priceQuote && (priceQuote.mode !== "tick" || priceQuote.tick !== legacyQuote.tick || priceQuote.rawAsk !== legacyQuote.rawAsk))
          throw new Error("PM 调整报价不匹配，请新建投注尝试");
        tickQuote = priceQuote?.mode === "tick" ? priceQuote : Object.freeze({ ...legacyQuote });
        if (tickQuoteData.detectionMaxPrice !== tickQuote.cap || option.odds !== tickQuote.displayOdds)
          throw new Error("PM +1 tick 检测价已改变");
      } catch (err) {
        option.checkError = err instanceof Error ? err.message : String(err);
        option.data = null;
        return option;
      }
    }
    // 套利检测价：首次预检锁定建腿赔率；限价仅在 fo clob 与该赔率同档时用 fo，否则 1/detectionOdds
    const detectionOdds = Number(prior?.detectionOdds) > 1
      ? Number(prior!.detectionOdds)
      : option.odds;
    // [changmen 扩展] 两种调整报价都复用精确 cap，避免三位赔率倒数扩大限价。
    const maxPrice = priceQuote?.cap ?? tickQuote?.cap ?? resolvePolymarketDetectionMaxPrice(option, detectionOdds);
    const apiBetMoney = resolvePolymarketApiBetMoney(account, option);
    const gateway = account.gateway || POLYMARKET_CLOB_API;
    const tokenId = option.itemId;
    const initialInputs = checkInputBinding(account, option);
    try {
      // 立刻拉簿，不等 Gamma；两边都回才算预检成功（官方 Place Orders 第一步即 GET /book）
      const buyP = resolvePolymarketExecutableBuy(
        gateway,
        tokenId,
        detectionOdds,
        apiBetMoney,
        maxPrice,
      );
      const guardP = measurePmExecution("guard", { tokenId }, () => resolvePolymarketBetBlockReason(option));
      const clockP = context?.role === "precheckOnly" ? Promise.resolve()
        : measurePmExecution("clock", { tokenId }, () => pmPrepareSubmit(account));
      const runtimeP = context?.role === "precheckOnly" ? Promise.resolve(null) : measurePmExecution("runtime", { tokenId }, async () => {
        if (context?.prepareSigning && !await context.prepareSigning) throw new Error("请先解锁本机钱包");
        const config = parseTokenConfig(account.token);
        const creds = resolveApiCreds(config);
        const privateKey = resolvePrivateKey(config);
        if (!creds.address || !creds.apiKey || !creds.secret || !creds.passphrase || !privateKey)
          throw new Error("PM 钱包或 API 凭据未就绪，请解锁钱包并检查账号");
        const binding = preparationBinding(account, option);
        const generation = polymarketSigningGeneration();
        const prepared = await getPolymarketOrderClientRuntime({ gateway, config, creds, privateKey,
          signatureType: resolveSdkSignatureType(creds.signatureType) });
        return { ...prepared, binding, generation };
      });
      const [buySettled, guardSettled, runtimeSettled, clockSettled] = await Promise.allSettled([buyP, guardP, runtimeP, clockP]);
      if (guardSettled.status === "fulfilled" && guardSettled.value) {
        option.checkError = guardSettled.value;
        option.data = null;
        recordPmExecutionMetric({
          kind: "check",
          tokenId,
          accountId: Number(account.accountId) || undefined,
          ms: performance.now() - checkStartedAt,
          success: false,
          error: guardSettled.value,
          detectionOdds,
          detectionMaxPrice: maxPrice,
          apiBetMoney,
        });
        return option;
      }
      if (guardSettled.status === "rejected")
        console.warn("[Polymarket] bet guard gamma check failed", guardSettled.reason);
      if (buySettled.status === "rejected")
        throw buySettled.reason;

      if (runtimeSettled.status === "rejected") throw runtimeSettled.reason;
      if (clockSettled.status === "rejected") throw clockSettled.reason;
      if (context?.role !== "precheckOnly" && !pmSubmitClockReady(account)) throw new Error("PM 提交校时未就绪");
      const { price, bookOdds, orderOptions, bookFetchedAt, depthAvailableAtCap, depthNeedUsdc } = buySettled.value;
      if (tickQuote) {
        notePmTickBufferBook(tokenId, { asset_id: tokenId, tick_size: orderOptions.tickSize, timestamp: orderOptions.bookTimestamp });
        if (tickQuote.tick !== orderOptions.tickSize || pmTickBufferTick(tokenId) !== tickQuote.tick)
          throw new Error("PM tick 已改变，请等待新报价并新建投注尝试");
      }
      if (invalidatedChecks.has(option)) throw new Error("PM 每次预检须新建投注尝试");
      if (initialInputs !== checkInputBinding(account, option))
        throw new Error("PM 预检期间投注参数已改变，请新建尝试");
      if (runtimeSettled.value && (runtimeSettled.value.binding !== preparationBinding(account, option)
        || runtimeSettled.value.generation !== polymarketSigningGeneration())) throw new Error("PM 预检期间钱包或账号已改变");
      const limitPrice = polymarketFokLimitFromDetection(maxPrice, orderOptions.tickSize, price);
      // [changmen 扩展] 在实际限价确定后统一校验 SDK 编码份数，不自动增加用户注码。
      const shares = pmBuyOrderShares(apiBetMoney, limitPrice, orderOptions.tickSize);
      if (!Number.isFinite(shares) || shares < orderOptions.minOrderSize)
        throw new Error("Polymarket 下单金额低于最小份数（实际签单限价）");
      const latestTick = currentPmTick(tokenId, orderOptions.bookTimestamp);
      if (latestTick && !isPolymarketPriceOnTick(limitPrice, latestTick)) throw new Error("PM tick 已改变，冻结限价不再有效");
      for (const level of orderOptions.asks) Object.freeze(level);
      Object.freeze(orderOptions.asks);
      Object.freeze(orderOptions);
      option.odds = priceQuote || tickQuote ? detectionOdds : bookOdds;
      option.newOdds = priceQuote || tickQuote ? detectionOdds : bookOdds;
      option.data = {
        ...(priceQuote ? { pmPriceQuote: priceQuote } : {}),
        ...(tickQuote ? { pmBufferMode: "tick" as const, pmTickQuote: tickQuote } : {}),
        tokenId,
        odds: bookOdds,
        detectionOdds,
        detectionMaxPrice: maxPrice,
        detectionClobPrice: maxPrice,
        bookPrice: price,
        limitPrice,
        betMoney: option.betMoney,
        apiBetMoney,
        side: "BUY",
        bookFetchedAt,
        orderOptions,
        depthMultiplier: pmFokDepthReuseMultiplier(),
      } satisfies PolymarketBuyCheckData;
      Object.freeze(option.data);
      preparedBuys.set(option, { data: option.data as PolymarketBuyCheckData, runtime: runtimeSettled.value?.runtime ?? null,
        binding: context?.role === "precheckOnly" ? "" : preparationBinding(account, option), generation: polymarketSigningGeneration(),
        consumed: false, readyAt: performance.now(), cacheHit: runtimeSettled.value?.cacheHit ?? false, role: context?.role ?? "execute" });
      recordPmExecutionMetric({
        kind: "check",
        tokenId,
        accountId: Number(account.accountId) || undefined,
        ms: performance.now() - checkStartedAt,
        success: true,
        detectionOdds,
        detectionMaxPrice: maxPrice,
        bookPrice: price,
        fillPrice: price,
        apiBetMoney,
        depthAvailableAtCap,
        depthNeedUsdc,
        tickSize: Number(orderOptions.tickSize),
        minOrderSize: orderOptions.minOrderSize,
      });
    }
    catch (err) {
      if (isPolymarketPriceAboveDetectionError(err)) {
        try {
          syncPolymarketFoOnPriceAboveDetection(option, err);
        }
        catch (syncErr) {
          console.warn("[Polymarket] fo sync after price-above precheck failed", syncErr);
        }
      }
      option.checkError = err instanceof Error ? err.message : String(err);
      option.data = null;
    }
    if (!option.data) {
      recordPmExecutionMetric({
        kind: "check",
        tokenId,
        accountId: Number(account.accountId) || undefined,
        ms: performance.now() - checkStartedAt,
        success: false,
        error: option.checkError,
        detectionOdds,
        detectionMaxPrice: maxPrice,
        apiBetMoney,
      });
    }
    return option;
  },

  async betting(account: PlatformAccount, option: BetOption): Promise<BetResult> {
    const beginTime = Date.now();
    const bettingStarted = performance.now();
    const invalid = validatePolymarketPreparedBuy(account, option);
    if (invalid) return new BetResult("Polymarket", false, invalid);
    const prepared = preparedBuys.get(option)!;
    // 必须在第一个 await 之前消费。签名失败、超时或未知结果均不恢复。
    prepared.consumed = true;
    recordPmExecutionMetric({ kind: "prepared_wait", tokenId: option.itemId, linkId: option.diagnosticLinkId, ms: performance.now() - prepared.readyAt, success: true });
    const frozen = prepared.data;
    const config = parseTokenConfig(account.token);
    const creds = resolveApiCreds(config);
    const privateKey = resolvePrivateKey(config);
    const readiness = {
      accountId: Number(account.accountId) || undefined,
      tokenId: option.itemId,
      linkId: option.diagnosticLinkId,
      apiCredsReady: Boolean(creds.apiKey && creds.secret && creds.passphrase),
      privateKeyReady: Boolean(privateKey),
      signatureType: resolveSdkSignatureType(resolveSignatureType(config)),
      funderPresent: Boolean(resolveFunder(config)),
      ...builderCodeMetric(),
    };

    if (!creds.address) {
      recordPmExecutionMetric({ ...readiness, kind: "betting", success: false, error: "missing walletAddress" });
      return new BetResult("Polymarket", false, "凭证缺少 walletAddress");
    }
    if (!privateKey) {
      recordPmExecutionMetric({ ...readiness, kind: "betting", success: false, error: "missing privateKey" });
      return new BetResult("Polymarket", false, "缺少有效私钥：请先解锁本机钱包，或在账号设置中重新导入私钥");
    }
    if (!creds.apiKey || !creds.secret || !creds.passphrase) {
      recordPmExecutionMetric({ ...readiness, kind: "betting", success: false, error: "missing api credentials" });
      return new BetResult("Polymarket", false, "凭证缺少用户 API Key（apiKey/secret/passphrase），请重新通过插件采集");
    }

    const { detectionOdds, detectionMaxPrice: maxPrice } = frozen;
    if (!maxPrice || maxPrice <= 0 || maxPrice >= 1) {
      recordPmExecutionMetric({
        ...readiness,
        kind: "betting",
        ms: performance.now() - bettingStarted,
        success: false,
        error: `invalid maxPrice ${maxPrice}`,
      });
      return new BetResult("Polymarket", false, `无效检测价 ${maxPrice}（赔率 ${detectionOdds}）`);
    }

    const tokenId = option.itemId;
    const apiBetMoney = resolvePolymarketApiBetMoney(account, option);
    const executionReadiness = { ...readiness, bookReuse: true,
      bookAgeMs: Date.now() - frozen.bookFetchedAt, signWarm: true, orderClientCacheHit: prepared.cacheHit };
    let acceptedBet: BetResult | undefined;
    try {
      const { limitPrice: price, odds: bookOdds, orderOptions, bookPrice: fillPrice } = frozen;
      const depthAvailableAtCap = availableUsdcAtPrice(orderOptions.asks, maxPrice);
      const depthNeedUsdc = apiBetMoney * (frozen.depthMultiplier ?? 1);
      option.newOdds = bookOdds;
      const executionPriceMetrics = {
        detectionOdds,
        detectionMaxPrice: maxPrice,
        bookPrice: price,
        fillPrice,
        limitPrice: price,
        tickSize: Number(orderOptions.tickSize),
        apiBetMoney,
        depthAvailableAtCap,
        depthNeedUsdc,
        minOrderSize: orderOptions.minOrderSize,
      };
      const executionSubmitFields = {
        ...executionReadiness,
        ...executionPriceMetrics,
      };
      const orderBody = await measurePmExecution("sign", executionReadiness, () =>
        createPolymarketOrderBody(prepared.runtime!, creds.apiKey!, frozen),
      );
      // 签名期间若收到已知 tick 变更，只做本地有效性核验。
      validatePreparedPrice(frozen);
      if (prepared.generation !== polymarketSigningGeneration()
        || option.data !== frozen || prepared.binding !== preparationBinding(account, option)) throw new Error("PM 签名准备已失效");
      warmPolymarketUserWs(account, String(option.betId ?? "").trim());
      const submittedAt = Date.now();
      tracePolymarketOrder(account.accountId, null, "submit", { submittedAt, linkId: option.diagnosticLinkId });
      const result = await measurePmExecution("submit", executionSubmitFields, () =>
        guardedPmSubmit(account, orderBody, { version: orderOptions.version, negRisk: orderOptions.negRisk,
          validateBeforeDispatch: () => {
            validatePreparedPrice(frozen);
            if (prepared.generation !== polymarketSigningGeneration()
              || option.data !== frozen || prepared.binding !== preparationBinding(account, option))
              throw new Error("PM 签名准备已失效");
            if (!pmSubmitClockReady(account)) throw new Error("PM 提交校时未就绪，请重新预检");
          },
          recovery: { matchId: option.matchId, venueBetId: option.betId, itemId: option.itemId,
            target: option.target, betMoney: option.betMoney, odds: option.odds,
            linkId: option.diagnosticLinkId, betRowId: Number(option.bet?.id ?? 0),
            recoveryOnly: Boolean(option.deferPostAcceptSettlement || option.loseOrder) } },
          async () => {
            const response = await pmSubmitOrder<PolymarketOrderResponse>(account, orderBody);
            if (isPolymarketOrderAccepted(response)) {
              acceptedBet = Object.assign(new BetResult("Polymarket", true,
                `${response.orderID} / ${response.status} / 已受理待确认`, orderBody, response), {
                orderId: String(response.orderID), pending: !isPolymarketFokBuyFilled(response),
                beginTime: submittedAt, pmSubmittedAt: submittedAt,
              });
            }
            return response;
          }),
      );
      tracePolymarketOrder(account.accountId, result.orderID || null, "ack", {
        submittedAt, linkId: option.diagnosticLinkId, status: result.success ? result.status : "rejected",
      });
      if (result.pmSubmitNotSent)
        return new BetResult("Polymarket", false, result.errorMsg || "PM 提交前校验失败");

      if (isPolymarketTradingDisabledError(result)) {
        recordPmExecutionMetric({
          ...executionSubmitFields,
          kind: "betting",
          ms: performance.now() - bettingStarted,
          success: false,
          error: POLYMARKET_TRADING_DISABLED_MESSAGE,
          submitStatus: "trading_disabled",
        });
        return new BetResult("Polymarket", false, POLYMARKET_TRADING_DISABLED_MESSAGE);
      }

      if (!isPolymarketOrderAccepted(result)) {
        const diagnostic = diagnosticLines({
          tokenId,
          amountUsdc: apiBetMoney,
          displayedOdds: detectionOdds,
          displayedPrice: maxPrice,
          limitPrice: price,
          shares: apiBetMoney / price,
          minOrderSize: orderOptions.minOrderSize,
          availableUsdc: availableUsdc(orderOptions.asks),
          asks: orderOptions.asks,
        }).join("\n");
        const fallback = result?.success
          ? "订单已受理但未成交（status 非 matched/delayed 或 takingAmount 为空）"
          : "FOK 订单未成交（无足够流动性）";
        const failed = new BetResult(
          "Polymarket", false,
          `${polymarketOrderFailureMessage(result, fallback)}\n${diagnostic}`,
          orderBody, result,
        );
        // 已 POST：落库拒单用官方 orderID；标记 pmPosted 供编排区分预检/盘口失败
        failed.orderId = String(result?.orderID ?? "").trim() || null;
        failed.beginTime = beginTime;
        failed.tip = { pmPosted: true };
        recordPmExecutionMetric({
          ...executionSubmitFields,
          kind: "betting",
          ms: performance.now() - bettingStarted,
          success: false,
          error: polymarketOrderFailureMessage(result, fallback),
          submitStatus: String(result?.status ?? "unfilled").trim().toLowerCase() || "unfilled",
        });
        return failed;
      }

      const filled = isPolymarketFokBuyFilled(result);
      const pending = !filled;
      const msg = filled
        ? `${result.orderID} / ${result.status} / 成交 ${result.takingAmount} tokens`
        : pending
          ? `${result.orderID} / ${result.status} / 待确认（体育延迟撮合中）`
          : `${result.orderID} / ${result.status} / 已受理待链上确认`;
      const bet = new BetResult("Polymarket", true, msg, orderBody, result);
      bet.orderId = String(result.orderID ?? "").trim() || null;
      bet.pending = pending;
      bet.beginTime = submittedAt;
      bet.pmSubmittedAt = submittedAt;
      acceptedBet = bet;
      if (filled && bet.orderId) {
        try { finishPmSubmitAttempt(account, bet.orderId); } catch { /* ACK 不改变 */ }
      }
      if (bet.orderId)
        markPolymarketChangmenOrder(account.accountId, bet.orderId);
      bumpPolymarketOrderSyncAfterBet(account.accountId);
      if (pending && bet.orderId) {
        const conditionId = String(option.betId ?? "").trim();
        // 官方 delay 窗：CLOB market.sd（秒）；未知不得按 1s 收尾
        const delayInfo = conditionId
          ? await fetchPolymarketMarketSecondsDelay(conditionId)
          : { secondsDelay: UNKNOWN_SPORTS_SECONDS_DELAY, takerOrderDelayEnabled: false, fromMarket: false };
        const sd = delayInfo.fromMarket ? delayInfo.secondsDelay : UNKNOWN_SPORTS_SECONDS_DELAY;
        const poll = buildPolymarketDelayedPollOpts(sd);
        const watchTimeoutMs = buildPolymarketWatchTimeoutMs(sd);
        if (conditionId) {
          registerPolymarketOrderWatch(account, bet.orderId, {
            conditionId,
            timeoutMs: watchTimeoutMs,
          });
        }
        else {
          console.warn(
            "[Polymarket] delayed 单缺少 betId(condition_id)，User WS 未订阅；拒单检测仅走 REST",
          );
        }
        // delayed：后台确认成交（拒单/撮合）；手动卖出见 pmManualSell
        startPolymarketSettlementJob(account, bet.orderId, { poll, conditionId, submittedAt });
      }
      recordPmExecutionMetric({
        ...executionSubmitFields,
        kind: "betting",
        ms: performance.now() - bettingStarted,
        success: true,
        submitStatus: String(result.status ?? "").trim().toLowerCase() || (pending ? "delayed" : "matched"),
      });
      return bet;
    } catch (err) {
      if (acceptedBet) return acceptedBet;
      if (err instanceof PmSubmitUnknownError) {
        const attempt = err.attempt;
        return Object.assign(new BetResult("Polymarket", false, err.message,
          { order: { side: "BUY", makerAmount: attempt.makerAmount, takerAmount: attempt.takerAmount } }), {
          orderId: attempt.orderHash, pmSubmitUnknown: true, pending: true,
          pmSubmittedAt: attempt.submittedAt, beginTime: attempt.submittedAt,
          link: attempt.recovery?.linkId ?? 0,
        });
      }
      if (isPolymarketPriceAboveDetectionError(err)) {
        try {
          syncPolymarketFoOnPriceAboveDetection(option, err);
        }
        catch (syncErr) {
          console.warn("[Polymarket] fo sync after price-above bet failed", syncErr);
        }
      }
      recordPmExecutionMetric({
        ...executionReadiness,
        kind: "betting",
        ms: performance.now() - bettingStarted,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return new BetResult("Polymarket", false, polymarketSubmitCatchMessage(err));
    }
  },
};
