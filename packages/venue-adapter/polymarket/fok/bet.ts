import { checkFokBuy, PolymarketBuyCheckData, preparedBuys, preparationBinding, availableUsdc, availableUsdcAtPrice, diagnosticLines, resolvePolymarketApiBetMoney } from "./preflight";
export type { PolymarketOrderOptions, PolymarketBuyCheckData } from "./preflight";
import type { AccountBalanceResult, PlatformProvider, ResolveLegOutcomeOpts } from "../../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { currentPmTick } from "../pmTickState";
import { validatePmPriceQuote } from "../priceQuote";
import { validatePmTickBufferQuote, pmTickBufferTick } from "../pmTickBuffer";
import { POLYMARKET_CLOB_API } from "../api";
import { resolvePolymarketBuilderCode } from "../builder";
import { buildL2HeadersFromAccount, parseTokenConfig, resolveApiCreds, resolveFunder, resolvePrivateKey, resolveSignatureType } from "../l2Auth";
import { fetchPolymarketVenueOrdersMerged } from "../orders";
import { markPolymarketChangmenOrder } from "../pmOrigin";
import { bumpPolymarketOrderSyncAfterBet } from "../pmOrderSync";
import { registerPolymarketOrderWatch, warmPolymarketUserWs } from "../userWs";
import { tracePolymarketOrder } from "../orderTrace";
import { startPolymarketSettlementJob } from "../settlementJob";
import { UNKNOWN_SPORTS_SECONDS_DELAY, buildPolymarketDelayedPollOpts, buildPolymarketWatchTimeoutMs, fetchPolymarketMarketSecondsDelay } from "../marketDelay";
import { resolvePolymarketProviderLegOutcome } from "../legOutcome";
import { isPolymarketSubmitTimeoutError, isPolymarketTradingDisabledError, POLYMARKET_SUBMIT_TIMEOUT_MESSAGE, POLYMARKET_TRADING_DISABLED_MESSAGE } from "../pmMarketGuard";
import { getPolymarketPmSportBlockReasonFromOption } from "../pmSportGuard";
import { optimizedFokQuoteBlock } from "../submission/preflight/optimized/pmExecutableQuote";
import { isPolymarketPriceAboveDetectionError, syncPolymarketFoOnPriceAboveDetection } from "../pmTokenQuote";
import { isPolymarketPriceOnTick } from "../pmTickPrice";
import { resolvePolymarketVenueIdentityFromToken } from "../profile";
import { polymarketPluginGet } from "../transport";
import { pmSubmitClockReady, pmSubmitOrder } from "../pmClientApi";
import { guardedPmSubmit } from "../pmSubmitJournal";
import { measurePmExecution, recordPmExecutionMetric } from "../pmExecutionMetrics";
import { polymarketSigningGeneration, type PolymarketOrderClientRuntime } from "../pmOrderClientCache";

export { isPolymarketDelayedPending } from "../orderStatus";
export {
  fetchPolymarketOrderRow,
  formatPolymarketSettlementMessage,
  pollPolymarketDelayedOrder,
} from "../orderStatus";
export { settlePolymarketDelayedOrder } from "../orderSettlement";
export {
  awaitPolymarketSettlementJob,
  clearPolymarketSettlementJobs,
  startPolymarketSettlementJob,
} from "../settlementJob";

const BALANCE_PATH = "/balance-allowance";

const COLLATERAL_DECIMALS = 1_000_000;

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

/** [changmen 扩展] 双腿发单前可同步核验；不拉簿、不重新定价、不消费。 */
export function validatePolymarketPreparedBuy(account: PlatformAccount, option: BetOption): string | null {
  const prepared = preparedBuys.get(option);
  // [changmen 扩展] 复核属于优化方式；原有方式保持线上提交语义，使用该次尝试的私有快照。
  if (prepared?.preflightMode === "optimized") {
    const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
    if (sportBlock) return sportBlock;
    const quoteBlock = optimizedFokQuoteBlock(prepared.data.tokenId, prepared.data.limitPrice, prepared.data.bookFetchedAt);
    if (quoteBlock) return quoteBlock;
  }
  if (!prepared || prepared.data !== option.data) return "PM 缺少本轮预检结果";
  if (prepared.consumed) return "PM 本轮预检结果已消费";
  if (prepared.role !== "execute" || !prepared.runtime) return "PM 此腿仅预检";
  if (option.checkError) return option.checkError;
  if (!pmSubmitClockReady(account)) return "PM 提交校时准备已失效";
  if (prepared.generation !== polymarketSigningGeneration(account)) return "PM 钱包会话已失效";
  try { validatePreparedPrice(prepared.data); }
  catch (err) { return err instanceof Error ? err.message : "PM 冻结报价失效"; }
  try {
    if (prepared.binding !== preparationBinding(account, option)) return "PM 下单参数或账号已改变，请新建尝试";
  } catch { return "PM 签名准备已失效"; }
  return null;
}

function polymarketSubmitCatchMessage(err: unknown): string {
  if (isPolymarketTradingDisabledError(err))
    return POLYMARKET_TRADING_DISABLED_MESSAGE;
  if (isPolymarketSubmitTimeoutError(err) || /network error/i.test(err instanceof Error ? err.message : String(err)))
    return POLYMARKET_SUBMIT_TIMEOUT_MESSAGE;
  return err instanceof Error ? err.message : String(err);
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

  checkBet: checkFokBuy,

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
      preflightMode: prepared.preflightMode,
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
      if (prepared.generation !== polymarketSigningGeneration(account)
        || option.data !== frozen || prepared.binding !== preparationBinding(account, option)) throw new Error("PM 签名准备已失效");
      warmPolymarketUserWs(account, String(option.betId ?? "").trim());
      const submittedAt = Date.now();
      tracePolymarketOrder(account.accountId, null, "submit", { submittedAt, linkId: option.diagnosticLinkId });
      // [changmen 扩展] 按用户要求恢复 BUY 提交异常的普通失败/重试语义；
      // 不创建未知提交锁。有效受理回执仍进入原有成交核验。
      const result = await measurePmExecution("submit", executionSubmitFields, () =>
        guardedPmSubmit(account, orderBody, {
          version: orderOptions.version, negRisk: orderOptions.negRisk, buyFailurePolicy: "retry",
          validateBeforeDispatch: () => {
            if (prepared.preflightMode === "optimized") {
              const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
              if (sportBlock) throw new Error(sportBlock);
              const quoteBlock = optimizedFokQuoteBlock(frozen.tokenId, frozen.limitPrice, frozen.bookFetchedAt);
              if (quoteBlock) throw new Error(quoteBlock);
            }
            validatePreparedPrice(frozen);
            if (prepared.generation !== polymarketSigningGeneration(account)
              || option.data !== frozen || prepared.binding !== preparationBinding(account, option))
              throw new Error("PM 签名准备已失效");
            if (!pmSubmitClockReady(account)) throw new Error("PM 提交校时未就绪，请重新预检");
          },
        }, async () => {
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
            submittedOrderType: "FOK",
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
