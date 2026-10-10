import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PolymarketOrderClientRuntime } from "../pmOrderClientCache";
import type { GtcBuyCheckData } from "./contract";
import { POLYMARKET_CLOB_API } from "../api";
import { resolvePolymarketBuilderCode } from "../builder";
import { parseTokenConfig, resolveApiCreds, resolvePrivateKey } from "../l2Auth";
import { resolvePolymarketBetBlockReason } from "../pmBetGuard";
import { pmGetBook, pmPrepareSubmit, pmSubmitClockReady } from "../pmClientApi";
import { resolvePolymarketDetectionMaxPrice } from "../pmDetection";
import { polymarketMarketOrderOptions } from "../pmMarketOrderOptions";
import { getPolymarketOrderClientRuntime, polymarketSigningGeneration } from "../pmOrderClientCache";
import { resolvePmOrderSubmitHttpMode } from "../pmOrderSubmitMode";
import { getPolymarketPmSportBlockReasonFromOption } from "../pmSportGuard";
import { resolvePolymarketVenueStakeUsdc } from "../pmStake";
import { alignPolymarketPriceToTick, isPolymarketPriceOnTick } from "../pmTickPrice";
import { currentPmTick } from "../pmTickState";
import { validatePmPriceQuote } from "../priceQuote";
import { buildPreparedGtcBuy } from "./index";

interface Book {
  asset_id?: string;
  timestamp?: string | number;
  version?: string;
  min_order_size?: number | string;
  neg_risk?: boolean;
  tick_size?: string;
  asks?: Array<{ price: string; size: string }>;
}
interface Prepared {
  data: GtcBuyCheckData;
  runtime: PolymarketOrderClientRuntime;
  binding: string;
  generation: number;
  consumed: boolean;
}
const preparations = new WeakMap<BetOption, Prepared>();
const checked = new WeakSet<BetOption>();
function inputs(account: PlatformAccount, option: BetOption): string {
  return JSON.stringify([account.accountId, account.gateway, account.currency, option.type, option.matchId, option.betId, option.itemId, option.target, option.betMoney, option.odds, option.data]);
}
function binding(account: PlatformAccount, option: BetOption): string {
  return JSON.stringify([inputs(account, option), account.token, resolvePolymarketBuilderCode(), resolvePmOrderSubmitHttpMode()]);
}

/** [changmen 扩展] 手动 GTC 允许限价内零深度；不调用/改变 FOK 预检。 */
export async function checkGtcBuy(account: PlatformAccount, option: BetOption, prepareSigning?: Promise<boolean>, requireImmediateDepth = false): Promise<BetOption> {
  try {
    if (account.provider !== "Polymarket" || option.type !== "Polymarket" || checked.has(option))
      throw new Error("PM 手动 GTC 每次预检须新建投注尝试");
    checked.add(option); preparations.delete(option);
    const local = getPolymarketPmSportBlockReasonFromOption(option);
    if (local)
      throw new Error(local);
    option.checkError = undefined;
    const frozenInputs = inputs(account, option);
    const generation = polymarketSigningGeneration();
    const prior = option.data;
    const quote = prior?.pmPriceQuote ? validatePmPriceQuote(prior.pmPriceQuote, option.itemId, option.odds) : undefined;
    if (quote && prior?.detectionMaxPrice !== quote.cap)
      throw new Error("PM 手动 GTC 冻结报价已改变");
    const maxPrice = quote?.cap ?? resolvePolymarketDetectionMaxPrice(option, option.odds);
    const apiBetMoney = resolvePolymarketVenueStakeUsdc(option.betMoney);
    if (!Number.isFinite(option.betMoney) || option.betMoney <= 0 || apiBetMoney > option.betMoney + 1e-9)
      throw new Error("PM 手动 GTC 金额不足，不能放大用户输入金额");
    const gateway = account.gateway || POLYMARKET_CLOB_API;
    const tasks = await Promise.allSettled([
      pmGetBook<Book>(option.itemId, gateway),
      resolvePolymarketBetBlockReason(option),
      pmPrepareSubmit(account),
      (async () => {
        if (prepareSigning && !await prepareSigning)
          throw new Error("请先解锁本机钱包");
        const config = parseTokenConfig(account.token); const creds = resolveApiCreds(config); const privateKey = resolvePrivateKey(config);
        if (!privateKey || !creds.address || !creds.apiKey || !creds.secret || !creds.passphrase)
          throw new Error("PM 钱包或 API 凭据未就绪");
        const token = account.token;
        const signatureType = Number(creds.signatureType ?? 0);
        const prepared = await getPolymarketOrderClientRuntime({ gateway, config, creds, privateKey, signatureType: [1, 2, 3].includes(signatureType) ? signatureType : 0 });
        if (account.token !== token)
          throw new Error("PM 预检期间钱包凭据已改变");
        return prepared.runtime;
      })(),
    ] as const);
    for (const task of tasks) {
      if (task.status === "rejected")
        throw task.reason;
    }
    const [bookTask, guardTask, , runtimeTask] = tasks;
    if (bookTask.status !== "fulfilled" || guardTask.status !== "fulfilled" || runtimeTask.status !== "fulfilled")
      throw new Error("PM 手动 GTC 预检未完成");
    if (guardTask.value)
      throw new Error(guardTask.value);
    const book = bookTask.value;
    const market = polymarketMarketOrderOptions(book, option.itemId);
    const bookTimestamp = Number(book.timestamp) || 0;
    const tick = currentPmTick(option.itemId, bookTimestamp) ?? market.tickSize;
    if (tick !== market.tickSize || (quote?.mode === "tick" && quote.tick !== tick))
      throw new Error("PM tick 已改变，请新建手动订单");
    const limitPrice = alignPolymarketPriceToTick(maxPrice, tick, "floor");
    if (!(limitPrice > 0 && limitPrice < 1) || !Array.isArray(book.asks))
      throw new Error("PM 手动 GTC 限价或订单簿无效");
    if (frozenInputs !== inputs(account, option) || generation !== polymarketSigningGeneration() || !pmSubmitClockReady(account))
      throw new Error("PM 手动 GTC 预检参数或钱包会话已失效");
    const asks = book.asks.map(row => ({ price: Number(row.price), size: Number(row.size) }))
      .filter(row => Number.isFinite(row.price) && Number.isFinite(row.size) && row.price > 0 && row.price < 1 && row.size > 0);
    // Retain automatic pair preflight; a manual resting order is an independent explicit decision.
    if (requireImmediateDepth && asks.filter(row => row.price <= limitPrice + 1e-9).reduce((sum, row) => sum + row.price * row.size, 0) + 1e-9 < apiBetMoney)
      throw new Error("GTC 自动套利限价内深度不足，未发送双腿");
    const data: GtcBuyCheckData = { ...(quote ? { pmPriceQuote: quote } : {}), tokenId: option.itemId, odds: option.odds, detectionOdds: option.odds, detectionMaxPrice: maxPrice, detectionClobPrice: maxPrice, bookPrice: asks.length ? Math.min(...asks.map(row => row.price)) : limitPrice, limitPrice, betMoney: option.betMoney, apiBetMoney, side: "BUY", bookFetchedAt: Date.now(), orderOptions: { ...market, bookTimestamp, asks } };
    for (const row of asks) Object.freeze(row);
    Object.freeze(asks); Object.freeze(data.orderOptions); Object.freeze(data);
    option.data = data;
    preparations.set(option, { data, runtime: runtimeTask.value, binding: binding(account, option), generation, consumed: false });
  }
  catch (error) {
    preparations.delete(option); option.data = null;
    option.checkError = error instanceof Error ? error.message : "PM 手动 GTC 预检失败";
  }
  return option;
}

export function checkManualGtcBuy(account: PlatformAccount, option: BetOption, prepareSigning?: Promise<boolean>): Promise<BetOption> {
  return checkGtcBuy(account, option, prepareSigning);
}

export async function prepareManualGtcBuy(account: PlatformAccount, option: BetOption) {
  const prepared = preparations.get(option);
  const validate = () => {
    if (!prepared || prepared.consumed || prepared.data !== option.data || option.checkError
      || prepared.generation !== polymarketSigningGeneration() || prepared.binding !== binding(account, option) || !pmSubmitClockReady(account)) {
      throw new Error("PM 手动 GTC 预检已失效或已消费，禁止重发");
    }
    const { orderOptions, limitPrice } = prepared.data;
    const tick = currentPmTick(option.itemId, orderOptions.bookTimestamp) ?? orderOptions.tickSize;
    if (tick !== orderOptions.tickSize || !isPolymarketPriceOnTick(limitPrice, tick))
      throw new Error("PM tick 已改变，请新建手动订单");
  };
  validate();
  return buildPreparedGtcBuy(account, option, { data: prepared!.data, runtime: prepared!.runtime, validate, consume: () => { validate(); prepared!.consumed = true; } });
}
