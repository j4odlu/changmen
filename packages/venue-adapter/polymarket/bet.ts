import type { AccountBalanceResult, PlatformProvider, ResolveLegOutcomeOpts } from "../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { resolvePolymarketVenueStakeUsdc } from "./pmStake";
import { POLYMARKET_CLOB_API } from "./api";
import { resolvePolymarketBuilderCode } from "./builder";
import {
  buildL2HeadersFromAccount,
  parseTokenConfig,
  resolveApiCreds,
  resolveFunder,
  resolvePrivateKey,
  resolveSignatureType,
  type PolymarketTokenConfig,
} from "./l2Auth";
import {
  fetchPolymarketVenueOrdersMerged,
} from "./orders";
import { isPolymarketDelayedPending } from "./orderStatus";
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
  alignPolymarketPriceToTick,
  normalizePolymarketTickSize,
  type PolymarketTickSize,
} from "./pmTickPrice";
import { resolvePolymarketVenueIdentityFromToken } from "./profile";
import { polymarketPluginGet } from "./transport";
import { pmGetBook, pmSubmitOrder } from "./pmClientApi";
import { measurePmExecution, recordPmExecutionMetric } from "./pmExecutionMetrics";
import {
  getPolymarketOrderClientRuntime,
  hasPolymarketOrderClientRuntime,
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
type Hex = `0x${string}`;
type TickSize = PolymarketTickSize;

interface PolymarketBalanceAllowanceResponse {
  balance?: string | number;
  allowance?: string | number;
}

interface PolymarketOrderResponse {
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
  if (isPolymarketFokBuyFilled(result))
    return true;
  if (!result?.success)
    return false;
  const status = String(result.status ?? "").trim().toLowerCase();
  const orderId = String(result.orderID ?? "").trim();
  return status === "delayed" && orderId.length > 0;
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
  tickSize: TickSize;
  minOrderSize: number;
  negRisk: boolean;
  asks: Array<{ price: number; size: number }>;
}

/**
 * 刚拉过的 /book 可直接拿去签单提交。
 * 覆盖混合对：CLOB 重检 → 锁即时馆 → 两边同时 POST。
 * 超时则 betting 再拉簿（手动隔很久再点下单）。
 */
export const PRECHECK_BOOK_REUSE_MS = 1500;

let polymarketClobSdkWarm: Promise<unknown> | null = null;

/** 预检成功后预加载签名 SDK，避免即时馆已 POST 才开始动态 import */
export function warmupPolymarketClobSdk(): void {
  if (polymarketClobSdkWarm)
    return;
  polymarketClobSdkWarm = Promise.all([
    import("@polymarket/clob-client-v2"),
    import("viem"),
    import("viem/accounts"),
  ]).catch(() => {
    polymarketClobSdkWarm = null;
  });
}

function isPolymarketClobSdkWarmStarted(): boolean {
  return Boolean(polymarketClobSdkWarm);
}

/** checkBet 写入、betting 可复用的 PM 买单预检缓存 */
export interface PolymarketBuyCheckData {
  tokenId: string;
  odds: number;
  detectionOdds: number;
  detectionMaxPrice: number;
  /** 与 detectionMaxPrice 相同；fo clobPrice 锁定值 */
  detectionClobPrice?: number;
  bookPrice: number;
  betMoney: number;
  apiBetMoney: number;
  side: "BUY";
  bookFetchedAt: number;
  orderOptions: PolymarketOrderOptions;
  /** 预检时的深度倍数（关=1）；复用 book 时须一致 */
  depthMultiplier?: number;
}

function isPolymarketBuyCheckData(data: unknown): data is PolymarketBuyCheckData {
  if (!data || typeof data !== "object")
    return false;
  const row = data as PolymarketBuyCheckData;
  return row.side === "BUY"
    && Boolean(row.tokenId)
    && Number.isFinite(row.bookFetchedAt) && row.bookFetchedAt > 0
    && row.orderOptions != null
    && Array.isArray(row.orderOptions.asks);
}

function reusedPolymarketBuyCheck(
  option: BetOption,
  tokenId: string,
  detectionOdds: number,
  apiBetMoney: number,
  maxPrice: number,
): PolymarketBuyCheckData | null {
  const diagnostic = diagnosePolymarketBuyCheckReuse(option, tokenId, detectionOdds, apiBetMoney, maxPrice);
  return diagnostic.data;
}

type PolymarketBuyCheckReuseRejectReason =
  | "missing_data"
  | "token_mismatch"
  | "detection_odds_mismatch"
  | "max_price_mismatch"
  | "amount_mismatch"
  | "expired"
  | "depth_multiplier_mismatch";

interface PolymarketBuyCheckReuseDiagnostic {
  data: PolymarketBuyCheckData | null;
  bookAgeMs?: number;
  rejectReason?: PolymarketBuyCheckReuseRejectReason;
}

function diagnosePolymarketBuyCheckReuse(
  option: BetOption,
  tokenId: string,
  detectionOdds: number,
  apiBetMoney: number,
  maxPrice: number,
): PolymarketBuyCheckReuseDiagnostic {
  const prior = option.data;
  if (!isPolymarketBuyCheckData(prior))
    return { data: null, rejectReason: "missing_data" };
  const bookAgeMs = Date.now() - prior.bookFetchedAt;
  if (prior.tokenId !== tokenId)
    return { data: null, bookAgeMs, rejectReason: "token_mismatch" };
  if (Number(prior.detectionOdds) !== detectionOdds)
    return { data: null, bookAgeMs, rejectReason: "detection_odds_mismatch" };
  if (Number(prior.detectionMaxPrice) !== maxPrice)
    return { data: null, bookAgeMs, rejectReason: "max_price_mismatch" };
  if (Number(prior.apiBetMoney) !== apiBetMoney)
    return { data: null, bookAgeMs, rejectReason: "amount_mismatch" };
  if (bookAgeMs > PRECHECK_BOOK_REUSE_MS)
    return { data: null, bookAgeMs, rejectReason: "expired" };
  if ((prior.depthMultiplier ?? 1) !== pmFokDepthReuseMultiplier())
    return { data: null, bookAgeMs, rejectReason: "depth_multiplier_mismatch" };
  return { data: prior, bookAgeMs };
}

/** BUY FOK 限价打在检测上限（向下对齐 tick），不是当前卖一 */
function polymarketFokLimitFromDetection(
  maxPrice: number,
  tickSize: TickSize,
  fillPrice: number,
): number {
  const aligned = alignPolymarketPriceToTick(maxPrice, tickSize, "floor");
  const limit = fillPrice > aligned + 1e-12 ? fillPrice : aligned;
  if (!isValidClobPrice(limit))
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
  return {
    tickSize: normalizePolymarketTickSize(book?.tick_size ?? book?.minimum_tick_size),
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
      "Polymarket 盘口价高于检测价，整单取消",
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
  gateway: string,
  privateKey: Hex,
  creds: ReturnType<typeof resolveApiCreds>,
  config: PolymarketTokenConfig,
  tokenId: string,
  price: number,
  amount: number,
  orderOptions: PolymarketOrderOptions,
) {
  const { runtime } = await getPolymarketOrderClientRuntime({
    gateway,
    privateKey,
    creds,
    config,
    signatureType: resolveSdkSignatureType(creds.signatureType),
  });
  const { client, clob, builderCode } = runtime;
  // SDK TickSize 尚未含官方 0.0025；运行时仍按 book tick 写入
  client.tickSizes[tokenId] = orderOptions.tickSize as any;
  client.negRisk[tokenId] = orderOptions.negRisk;
  client.feeInfos[tokenId] = { rate: 0, exponent: 0 };
  // SDK 会 GET /fees/builder-fees/{code}；浏览器走插件，此处预填避免 ClobClient 直连 axios 卡住/跨域
  client.builderFeeRates[builderCode] = { maker: 0, taker: 0 };
  const signedOrder = await client.createMarketOrder({
    tokenID: tokenId,
    price,
    amount,
    side: clob.Side.BUY,
  }, orderOptions as any);
  if (!clob.isV2Order(signedOrder))
    throw new Error("Polymarket SDK 未生成 CLOB v2 订单");
  return clob.orderToJsonV2(signedOrder, creds.apiKey!, clob.OrderType.FOK, false, false);
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

function resolvePolymarketDetectionOdds(option: BetOption): number {
  const data = option.data as { detectionOdds?: number } | null | undefined;
  const fromData = Number(data?.detectionOdds);
  if (Number.isFinite(fromData) && fromData > 1)
    return fromData;
  return option.odds;
}

async function resolvePolymarketExecutableBuyForBet(
  gateway: string,
  tokenId: string,
  detectionOdds: number,
  apiBetMoney: number,
  option: BetOption,
): Promise<{
  price: number;
  bookOdds: number;
  orderOptions: PolymarketOrderOptions;
  fillPrice: number;
  depthAvailableAtCap: number;
  depthNeedUsdc?: number;
}> {
  const maxPrice = resolvePolymarketDetectionMaxPrice(option, detectionOdds);
  const reused = reusedPolymarketBuyCheck(option, tokenId, detectionOdds, apiBetMoney, maxPrice);
  const resolved = reused
    ? {
        bookOdds: reused.odds,
        orderOptions: reused.orderOptions,
        depthAvailableAtCap: availableUsdcAtPrice(reused.orderOptions.asks, maxPrice),
        depthNeedUsdc: pmFokDepthBufferNeedUsdc(apiBetMoney) ?? apiBetMoney,
      }
    : await resolvePolymarketExecutableBuy(gateway, tokenId, detectionOdds, apiBetMoney, maxPrice);
  const fillPrice = calculateBuyMarketLimitPrice(
    resolved.orderOptions.asks,
    apiBetMoney,
    resolved.orderOptions.minOrderSize,
    {
      tokenId,
      amountUsdc: apiBetMoney,
      displayedOdds: detectionOdds,
      displayedPrice: maxPrice,
      minOrderSize: resolved.orderOptions.minOrderSize,
    },
    maxPrice,
  );
  const price = polymarketFokLimitFromDetection(
    maxPrice,
    resolved.orderOptions.tickSize,
    fillPrice,
  );
  return {
    price,
    bookOdds: resolved.bookOdds,
    orderOptions: resolved.orderOptions,
    fillPrice,
    depthAvailableAtCap: resolved.depthAvailableAtCap,
    depthNeedUsdc: resolved.depthNeedUsdc,
  };
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

  async checkBet(account: PlatformAccount, option: BetOption): Promise<BetOption> {
    const checkStartedAt = Date.now();
    const localBlock = getPolymarketPmSportBlockReasonFromOption(option);
    if (localBlock) {
      option.checkError = localBlock;
      option.data = null;
      recordPmExecutionMetric({
        kind: "check",
        tokenId: option.itemId,
        accountId: Number(account.accountId) || undefined,
        ms: Date.now() - checkStartedAt,
        success: false,
        error: localBlock,
      });
      return option;
    }

    const prior = option.data as PolymarketOptionQuoteData | PolymarketBuyCheckData | null | undefined;
    // 套利检测价：首次预检锁定建腿赔率；限价仅在 fo clob 与该赔率同档时用 fo，否则 1/detectionOdds
    const detectionOdds = Number(prior?.detectionOdds) > 1
      ? Number(prior!.detectionOdds)
      : option.odds;
    const maxPrice = resolvePolymarketDetectionMaxPrice(option, detectionOdds);
    const apiBetMoney = resolvePolymarketApiBetMoney(account, option);
    const gateway = account.gateway || POLYMARKET_CLOB_API;
    const tokenId = option.itemId;
    try {
      // 立刻拉簿，不等 Gamma；两边都回才算预检成功（官方 Place Orders 第一步即 GET /book）
      const buyP = resolvePolymarketExecutableBuy(
        gateway,
        tokenId,
        detectionOdds,
        apiBetMoney,
        maxPrice,
      );
      const guardP = resolvePolymarketBetBlockReason(option);
      const [buySettled, guardSettled] = await Promise.allSettled([buyP, guardP]);
      if (guardSettled.status === "fulfilled" && guardSettled.value) {
        option.checkError = guardSettled.value;
        option.data = null;
        recordPmExecutionMetric({
          kind: "check",
          tokenId,
          accountId: Number(account.accountId) || undefined,
          ms: Date.now() - checkStartedAt,
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

      const { price, bookOdds, orderOptions, bookFetchedAt, depthAvailableAtCap, depthNeedUsdc } = buySettled.value;
      option.odds = bookOdds;
      option.newOdds = bookOdds;
      option.data = {
        tokenId,
        odds: bookOdds,
        detectionOdds,
        detectionMaxPrice: maxPrice,
        detectionClobPrice: maxPrice,
        bookPrice: price,
        betMoney: option.betMoney,
        apiBetMoney,
        side: "BUY",
        bookFetchedAt,
        orderOptions,
        depthMultiplier: pmFokDepthReuseMultiplier(),
      } satisfies PolymarketBuyCheckData;
      recordPmExecutionMetric({
        kind: "check",
        tokenId,
        accountId: Number(account.accountId) || undefined,
        ms: Date.now() - checkStartedAt,
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
      warmupPolymarketClobSdk();
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
        ms: Date.now() - checkStartedAt,
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
    const config = parseTokenConfig(account.token);
    const creds = resolveApiCreds(config);
    const privateKey = resolvePrivateKey(config);
    const readiness = {
      accountId: Number(account.accountId) || undefined,
      tokenId: option.itemId,
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

    const gateway = account.gateway || POLYMARKET_CLOB_API;

    const detectionOdds = resolvePolymarketDetectionOdds(option);
    const maxPrice = resolvePolymarketDetectionMaxPrice(option, detectionOdds);
    if (!maxPrice || maxPrice <= 0 || maxPrice >= 1) {
      recordPmExecutionMetric({
        ...readiness,
        kind: "betting",
        ms: Date.now() - beginTime,
        success: false,
        error: `invalid maxPrice ${maxPrice}`,
      });
      return new BetResult("Polymarket", false, `无效检测价 ${maxPrice}（赔率 ${detectionOdds}）`);
    }

    const tokenId = option.itemId;
    const apiBetMoney = resolvePolymarketApiBetMoney(account, option);
    const reuse = diagnosePolymarketBuyCheckReuse(option, tokenId, detectionOdds, apiBetMoney, maxPrice);
    const reused = reuse.data;
    if (reused)
      warmupPolymarketClobSdk();
    const orderClientInput = privateKey
      ? {
          gateway,
          privateKey,
          creds,
          config,
          signatureType: readiness.signatureType,
        }
      : null;
    const signWarm = isPolymarketClobSdkWarmStarted();
    const orderClientCacheHit = orderClientInput
      ? hasPolymarketOrderClientRuntime(orderClientInput)
      : false;
    const executionReadiness = {
      ...readiness,
      bookReuse: Boolean(reused),
      bookAgeMs: reuse.bookAgeMs,
      reuseRejectReason: reuse.rejectReason,
      signWarm,
      orderClientCacheHit,
    };
    if (!reused) {
      const pmBlock = await resolvePolymarketBetBlockReason(option);
      if (pmBlock) {
        recordPmExecutionMetric({
          ...executionReadiness,
          kind: "betting",
          ms: Date.now() - beginTime,
          success: false,
          error: pmBlock,
        });
        return new BetResult("Polymarket", false, pmBlock);
      }
    }

    try {
      const { price, bookOdds, orderOptions, fillPrice, depthAvailableAtCap, depthNeedUsdc } = await resolvePolymarketExecutableBuyForBet(
        gateway,
        tokenId,
        detectionOdds,
        apiBetMoney,
        option,
      );
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
        createPolymarketOrderBody(
          gateway,
          privateKey,
          creds,
          config,
          tokenId,
          price,
          apiBetMoney,
          orderOptions,
        ),
      );
      warmPolymarketUserWs(account, String(option.betId ?? "").trim());
      const submittedAt = Date.now();
      tracePolymarketOrder(account.accountId, null, "submit", { submittedAt, linkId: option.diagnosticLinkId });
      const result = await measurePmExecution("submit", executionSubmitFields, () =>
        pmSubmitOrder<PolymarketOrderResponse>(account, orderBody),
      );
      tracePolymarketOrder(account.accountId, result.orderID || null, "ack", {
        submittedAt, linkId: option.diagnosticLinkId, status: result.success ? result.status : "rejected",
      });

      if (isPolymarketTradingDisabledError(result)) {
        recordPmExecutionMetric({
          ...executionSubmitFields,
          kind: "betting",
          ms: Date.now() - beginTime,
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
          ms: Date.now() - beginTime,
          success: false,
          error: polymarketOrderFailureMessage(result, fallback),
          submitStatus: String(result?.status ?? "unfilled").trim().toLowerCase() || "unfilled",
        });
        return failed;
      }

      const filled = isPolymarketFokBuyFilled(result);
      const pending = isPolymarketDelayedPending(result);
      const msg = filled
        ? `${result.orderID} / ${result.status} / 成交 ${result.takingAmount} tokens`
        : pending
          ? `${result.orderID} / ${result.status} / 待确认（体育延迟撮合中）`
          : `${result.orderID} / ${result.status} / 已受理待链上确认`;
      const bet = new BetResult("Polymarket", true, msg, orderBody, result);
      bet.orderId = String(result.orderID ?? "").trim() || null;
      bet.pending = pending;
      bet.beginTime = submittedAt;
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
        ms: Date.now() - beginTime,
        success: true,
        submitStatus: String(result.status ?? "").trim().toLowerCase() || (pending ? "delayed" : "matched"),
      });
      return bet;
    } catch (err) {
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
        ms: Date.now() - beginTime,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return new BetResult("Polymarket", false, polymarketSubmitCatchMessage(err));
    }
  },
};
