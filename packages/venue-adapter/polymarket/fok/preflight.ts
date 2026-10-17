// [changmen 扩展] FOK 预检与准备状态；公共异步检查由 submission/preflight 承担。
import { runPmBuyPreflight, matchesPmPreflightBinding } from "../submission/preflight/pmBuyPreflight";
import { capturePmFokPreflightMode, type PmFokPreflightMode } from "../submission/preflight/pmFokPreflightMode";
import { optimizedFokQuoteBlock } from "../submission/preflight/optimized/pmExecutableQuote";
import type { PlatformProvider } from "../../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { resolvePolymarketVenueStakeUsdc } from "../pmStake";
import { currentPmTick } from "../pmTickState";
import { validatePmPriceQuote, type PmPriceQuote } from "../priceQuote";
import { validatePmTickBufferQuote, notePmTickBufferBook, pmTickBufferTick, type PmTickBufferQuote } from "../pmTickBuffer";
import { pmBuyOrderShares } from "../pmBuyOrderShares";
import { resolvePmHttpMode } from "../pmTransportMode";
import { resolvePmOrderSubmitHttpMode } from "../pmOrderSubmitMode";
import { getPmMarketWsSourceMode } from "../pmMarketWsMode";
import { POLYMARKET_CLOB_API } from "../api";
import { resolvePolymarketBuilderCode } from "../builder";
import { parseTokenConfig, resolvePrivateKey } from "../l2Auth";
import { isPolymarketTradingDisabledError, POLYMARKET_TRADING_DISABLED_MESSAGE } from "../pmMarketGuard";
import { getPolymarketPmSportBlockReasonFromOption } from "../pmSportGuard";
import { isValidClobPrice, resolvePolymarketDetectionMaxPrice, type PolymarketOptionQuoteData } from "../pmDetection";
import { isPolymarketPriceAboveDetectionError, PolymarketPriceAboveDetectionError, syncPolymarketFoOnPriceAboveDetection } from "../pmTokenQuote";
import { isPolymarketPriceOnTick, alignPolymarketPriceToTick, type PolymarketTickSize } from "../pmTickPrice";
import { pmSubmitClockReady, pmGetBook } from "../pmClientApi";
import { polymarketMarketOrderOptions } from "../pmMarketOrderOptions";
import { recordPmExecutionMetric } from "../pmExecutionMetrics";
import { polymarketSigningGeneration, type PolymarketOrderClientRuntime } from "../pmOrderClientCache";
import { pmFokDepthReuseMultiplier, getPmFokDepthBufferPrefs, pmFokDepthBufferNeedUsdc, pmFokFillPriceDepthUsdc } from "../pmFokDepthBufferMode";
type TickSize = PolymarketTickSize;

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
  pmPreflightMode?: PmFokPreflightMode;
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
  preflightMode: PmFokPreflightMode;
  data: PolymarketBuyCheckData;
  runtime: PolymarketOrderClientRuntime | null;
  binding: string;
  generation: number;
  consumed: boolean;
  role: "execute" | "precheckOnly";
  readyAt: number;
  cacheHit: boolean;
}
export const preparedBuys = new WeakMap<BetOption, PreparedBuy>();
const checkedOptions = new WeakSet<BetOption>();
const invalidatedChecks = new WeakSet<BetOption>();

function checkInputBinding(account: PlatformAccount, option: BetOption): string {
  // 钱包解锁可以补齐 token 中的私钥；行情、账号归属及路由参数须从预检入口保持一致。
  return JSON.stringify([account.accountId, account.gateway, account.currency,
    option.itemId, option.betId, option.betMoney, option.odds, option.data,
    option.target, option.type, option.matchId, pmFokDepthReuseMultiplier(),
    resolvePmHttpMode(), getPmMarketWsSourceMode(), resolvePmOrderSubmitHttpMode()]);
}

export function preparationBinding(account: PlatformAccount, option: BetOption): string {
  // 凭据只保留在内存，不写入 option、日志或订单元数据。
  return JSON.stringify([account.accountId, account.gateway, account.token,
    resolvePrivateKey(parseTokenConfig(account.token)), resolvePolymarketBuilderCode(),
    resolvePmHttpMode(), getPmMarketWsSourceMode(), resolvePmOrderSubmitHttpMode(), option.itemId, option.betId,
    option.betMoney, option.odds, option.target, option.type, option.matchId, account.currency, pmFokDepthReuseMultiplier()]);
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

export function availableUsdc(asks: PolymarketOrderOptions["asks"]): number {
  return asks.reduce((sum, level) => sum + level.price * level.size, 0);
}

export function availableUsdcAtPrice(
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

export function diagnosticLines(diag: PolymarketOrderDiagnostic): string[] {
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

/** 下单 USDC：仅以 option.betMoney（场馆口径）为准；禁止回退 data.apiBetMoney */
export function resolvePolymarketApiBetMoney(_account: PlatformAccount, option: BetOption): number {
  return resolvePolymarketVenueStakeUsdc(option.betMoney);
}

export async function checkFokBuy(account: PlatformAccount, option: BetOption, context?: Parameters<PlatformProvider["checkBet"]>[2]): Promise<BetOption> {
    const preflightMode = capturePmFokPreflightMode(option);
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
      recordPmExecutionMetric({ preflightMode,
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
      const { market: buySettled, guard: guardSettled, runtime: runtimeSettled, clock: clockSettled } = await runPmBuyPreflight(account, option, {
        sportMode: preflightMode,
        gateway,
        market: () => resolvePolymarketExecutableBuy(gateway, tokenId, detectionOdds, apiBetMoney, maxPrice),
        ...(preflightMode === "optimized" ? { shadowInput: { tokenId, detectionOdds, apiBetMoney, maxPrice, depth: getPmFokDepthBufferPrefs() } } : {}),
        role: context?.role,
        requireClobConfirmation: context?.requireClobConfirmation,
        runtimeBinding: () => preparationBinding(account, option),
        missingCredentialsMessage: "PM 钱包或 API 凭据未就绪，请解锁钱包并检查账号",
        measureStages: true,
      });
      if (guardSettled.status === "fulfilled" && guardSettled.value) {
        option.checkError = guardSettled.value;
        option.data = null;
        recordPmExecutionMetric({ preflightMode,
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
      if (runtimeSettled.value && (!matchesPmPreflightBinding(account, runtimeSettled.value, () => preparationBinding(account, option)))) throw new Error("PM 预检期间钱包或账号已改变");
      const limitPrice = polymarketFokLimitFromDetection(maxPrice, orderOptions.tickSize, price);
      if (preflightMode === "optimized") {
        const quoteBlock = optimizedFokQuoteBlock(tokenId, limitPrice, bookFetchedAt);
        if (quoteBlock) throw new Error(quoteBlock);
      }
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
        pmPreflightMode: preflightMode,
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
      preparedBuys.set(option, { preflightMode, data: option.data as PolymarketBuyCheckData, runtime: runtimeSettled.value?.runtime ?? null,
        binding: context?.role === "precheckOnly" ? "" : preparationBinding(account, option), generation: polymarketSigningGeneration(account),
        consumed: false, readyAt: performance.now(), cacheHit: runtimeSettled.value?.cacheHit ?? false, role: context?.role ?? "execute" });
      recordPmExecutionMetric({ preflightMode,
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
      recordPmExecutionMetric({ preflightMode,
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
  }
