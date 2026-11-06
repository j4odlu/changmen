import type { BetOption } from "@changmen/client-core/models/betOption";
/** [changmen 扩展] GTC V1：定量限价签单、单次发送及原单事实读取；不调用 FOK settlement。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { GtcFacts, GtcFill, GtcOrderReference } from "@changmen/shared/pm_gtc_order";
import type { PolymarketOrderClientRuntime } from "../submission/client/pmOrderClientCache";
import type { GtcBuyCheckData } from "./contract";
import { gtcDecimal, gtcFillPrice, gtcUnits } from "@changmen/shared/pm_gtc_order";
import { POLYMARKET_CLOB_API } from "../api";
import { parseTokenConfig, resolveApiCreds, resolveFunder } from "../auth/l2Auth";
import { pmCancelOrder, pmGetOrder, pmSubmitOrder } from "../orders/pmClientApi";
import { resolvePmOrderSubmitHttpMode } from "../pmOrderSubmitMode";
import { pmSignedOrderHash, pmSubmitMaker } from "../submission/recovery/pmSubmitJournal";
import { polymarketL2Get } from "../transport/transport";
import { warmPolymarketUserWs } from "../realtime/userWs";
import { fetchPolymarketUserActivityTrades, matchPolymarketActivityBuyCostByTxHashes, type PolymarketActivityTradeRow } from "../orders/history/pmActivity";
import { prepareManualGtcBuy } from "./preparation";
import { normalizeGtcTradeStatus } from "./tradeStatus";

export { pmCancelOrder, pmSubmitMaker };
export { checkGtcBuy, checkManualGtcBuy, prepareManualGtcBuy } from "./preparation";
export { exactGtcSellCash, readGtcSellCash } from "./sellCash";

function decimal(n: number) {
  if (!Number.isFinite(n) || n < 0)
    throw new Error("GTC 数值无效"); return gtcDecimal(gtcUnits(n.toFixed(6)));
}
export async function prepareGtcBuy(account: PlatformAccount, option: BetOption) {
  return prepareManualGtcBuy(account, option);
}

/** 两种 GTC 入口共用签单；手动预检与原 FOK 深度校验相互独立。 */
export async function buildPreparedGtcBuy(account: PlatformAccount, option: BetOption, prepared: {
  data: GtcBuyCheckData;
  runtime: PolymarketOrderClientRuntime;
  validate: () => void;
  prepareSubmit: () => Promise<void>;
  consume: () => void;
}) {
  warmPolymarketUserWs(account, option.betId);
  const { data, runtime } = prepared;
  const budget = data.apiBetMoney;
  // [changmen 扩展] 份数只按本金预算签定；成交后的实际 maker/taker 费用另记成本。
  const target = budget / data.limitPrice;
  const size = Number(gtcUnits(budget.toFixed(6)) * 100n / gtcUnits(data.limitPrice.toFixed(6))) / 100;
  if (!(size >= data.orderOptions.minOrderSize))
    throw new Error("GTC 下单金额低于最小份数");
  const signed = await runtime.builder.buildOrder({ tokenID: data.tokenId, price: data.limitPrice, size, side: runtime.clob.Side.BUY, builderCode: runtime.builderCode }, { tickSize: data.orderOptions.tickSize, negRisk: data.orderOptions.negRisk } as Parameters<typeof runtime.builder.buildOrder>[1], data.orderOptions.version);
  if (!runtime.clob.isV2Order(signed))
    throw new Error("GTC SDK 未生成受支持签单");
  const shares = gtcDecimal(BigInt(signed.takerAmount));
  const maxPrincipal = gtcDecimal(BigInt(signed.makerAmount));
  if (Number(shares) !== size || gtcUnits(maxPrincipal) > gtcUnits(budget.toFixed(6)))
    throw new Error("GTC 实际签单数量或预算越界");
  const hash = pmSignedOrderHash(signed, { version: data.orderOptions.version, negRisk: data.orderOptions.negRisk });
  const body = runtime.clob.orderToJsonV2(signed, resolveApiCreds(parseTokenConfig(account.token)).apiKey, runtime.clob.OrderType.GTC, false, false);
  return { shares, targetShares: decimal(target), price: decimal(data.limitPrice), maxPrincipal, allInBudget: decimal(budget), protocol: data.orderOptions.version, negRisk: data.orderOptions.negRisk, orderHash: hash, route: resolvePmOrderSubmitHttpMode(), validate: prepared.validate, prepareSubmit: prepared.prepareSubmit, submit: async (): Promise<GtcAck> => {
    try { await prepared.prepareSubmit(); prepared.consume(); }
    catch (error) { return { success: false, pmSubmitNotSent: true, errorMsg: error instanceof Error ? error.message : String(error) }; }
    return pmSubmitOrder<GtcAck>(account, body);
  } };
}
export interface GtcAck { success?: boolean; orderID?: string; status?: string; errorMsg?: string; pmSubmitNotSent?: boolean }
interface Trade { id?: string; taker_order_id?: string; asset_id?: string; side?: string; size?: string; price?: string; status?: string; last_update?: string; match_time?: string; transaction_hash?: string; fee_rate_bps?: string; maker_orders?: Array<{ order_id?: string; asset_id?: string; side?: string; matched_amount?: string; price?: string }> }

export function gtcTradeFills(trade: Trade, plan: GtcOrderReference, id: string): GtcFill[] {
  if (!trade.id)
    throw new Error("GTC tradeId 缺失");
  const own: Array<{ bucket: string; role: "MAKER" | "TAKER"; shares?: string; price?: string; asset?: string; side?: string }> = [];
  if (trade.taker_order_id?.toLowerCase() === id.toLowerCase())
    own.push({ bucket: "taker", role: "TAKER", shares: trade.size, price: trade.price, asset: trade.asset_id, side: trade.side });
  for (const maker of trade.maker_orders ?? []) {
    if (maker.order_id?.toLowerCase() === id.toLowerCase())
      own.push({ bucket: maker.order_id.toLowerCase(), role: "MAKER", shares: maker.matched_amount, price: maker.price, asset: maker.asset_id, side: maker.side });
  }
  return own.map((part) => {
    if (part.asset !== plan.tokenId || part.side?.toUpperCase() !== "BUY")
      throw new Error("GTC 原单成交 token/方向不一致");
    const shares = gtcDecimal(gtcUnits(part.shares)); const price = gtcFillPrice(part.price);
    const status = normalizeGtcTradeStatus(trade.status);
    if (!status)
      throw new Error("GTC 成交状态未知");
    const timestamp = Number(trade.last_update || trade.match_time);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
      throw new Error("GTC 成交时间缺失");
    return { key: `${trade.id}:${part.bucket}`, tradeId: trade.id!, bucket: part.bucket, role: part.role, shares, price, fee: null, status, updatedAt: timestamp < 1e12 ? timestamp * 1000 : timestamp };
  });
}

/** [changmen 扩展] 同账号 GTC 共享一轮完整成交分页；每张原单仍独立核对身份。 */
export interface GtcTradeHistory { trades: Trade[]; complete: boolean }
// 同账号同轮共享的 history 也共享 activity 分页；下一轮新 history 会重新查询。
const activityByHistory = new WeakMap<GtcTradeHistory, Map<string, Promise<PolymarketActivityTradeRow[]>>>();
export async function readGtcTradeHistory(account: PlatformAccount, since: number): Promise<GtcTradeHistory> {
  const trades: Trade[] = []; const seen = new Set<string>();
  let cursor = "MA=="; let complete = false;
  for (let page = 0; page < 50; page++) {
    if (seen.has(cursor))
      throw new Error("GTC 成交分页游标重复");
    seen.add(cursor);
    const query = new URLSearchParams({ after: String(Math.floor(since / 1000) - 60), next_cursor: cursor });
    const result = await polymarketL2Get<{ data?: Trade[]; next_cursor?: string }>(account, `${String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "")}/data/trades?${query}`, "/data/trades");
    if (!Array.isArray(result?.data) || typeof result.next_cursor !== "string")
      throw new Error("GTC 成交分页响应不完整");
    trades.push(...result.data); cursor = result.next_cursor;
    if (cursor === "LTE=") { complete = true; break; }
  }
  return { trades, complete };
}

/** 不完整分页、查单失败都保持未知；只按 exact orderId 聚合 maker 明细。 */
export async function readGtcFacts(account: PlatformAccount, plan: GtcOrderReference, id: string, since: number, sharedHistory?: Promise<GtcTradeHistory>): Promise<GtcFacts> {
  let order: Record<string, unknown> | null = null;
  let orderError = "GTC 本次原单查询未返回记录";
  try { order = await pmGetOrder<Record<string, unknown> | null>(account, id); }
  catch (error) { orderError = error instanceof Error ? error.message : "GTC 原单查询失败"; }
  if (order && String(order.id ?? "").toLowerCase() !== id.toLowerCase())
    throw new Error("GTC 原单身份不一致");
  if (order && (String(order.asset_id) !== plan.tokenId || String(order.side).toUpperCase() !== "BUY"))
    throw new Error("GTC 原单资产或方向不一致");
  const status = String(order?.status ?? "").trim().toUpperCase();
  // 官方 GET /data/order/{orderID} 还包含 INVALID 和 CANCELED_MARKET_RESOLVED：
  // https://docs.polymarket.com/api-reference/trade/get-single-order-by-id
  if (order && !["LIVE", "DELAYED", "MATCHED", "UNMATCHED", "CANCELED", "CANCELLED", "CANCELED_MARKET_RESOLVED", "INVALID", "EXPIRED", "REJECTED"].includes(status))
    throw new Error(`GTC 原单状态不支持（${status.slice(0, 80) || "缺失"}），需人工核实`);
  const history = await (sharedHistory ?? readGtcTradeHistory(account, since));
  const { complete } = history;
  const fills = new Map<string, GtcFill>();
  for (const trade of history.trades) {
    for (const fill of gtcTradeFills(trade, plan, id)) fills.set(fill.key, fill);
  }
  const ownFills = [...fills.values()];
  if (ownFills.some(fill => fill.status !== "FAILED")) {
    const config = parseTokenConfig(account.token);
    const wallet = String(resolveFunder(config) || resolveApiCreds(config).address || "").toLowerCase();
    const activityReads = activityByHistory.get(history) ?? new Map<string, Promise<PolymarketActivityTradeRow[]>>();
    activityByHistory.set(history, activityReads);
    if (!activityReads.has(wallet)) {
      const times = history.trades.map(trade => Number(trade.match_time || trade.last_update)).filter(t => Number.isFinite(t) && t > 0);
      const start = times.length ? Math.min(...times, since / 1000) : since / 1000;
      activityReads.set(wallet, fetchPolymarketUserActivityTrades(wallet, {
        side: "BUY", startSec: Math.max(1, Math.floor(start) - 120), endSec: Math.floor(Date.now() / 1000) + 60,
      }));
    }
    const activity = await activityReads.get(wallet)!;
    for (const fill of ownFills.filter(fill => fill.status !== "FAILED")) {
      const txs = [...new Set(history.trades.filter(trade => trade.id === fill.tradeId)
        .map(trade => String(trade.transaction_hash ?? "").toLowerCase()).filter(Boolean))];
      if (txs.length !== 1) continue;
      const cost = matchPolymarketActivityBuyCostByTxHashes(activity, txs, {
        proxyWallet: wallet, conditionId: plan.conditionId, tokenId: plan.tokenId,
      });
      // One wallet/asset activity may contain other orders: never allocate its total by a guess.
      if (!cost || Math.abs(cost.shares - Number(fill.shares)) > 0.000001) continue;
      fill.cost = gtcDecimal(gtcUnits(cost.usdcSize.toFixed(6)));
      fill.fee = gtcDecimal(gtcUnits(cost.feeUsdc.toFixed(6)));
      fill.price = gtcFillPrice(String(cost.matchPrice));
    }
  }
  if (!order) {
    const confirmed = ownFills.filter(fill => fill.status !== "FAILED");
    const quantity = confirmed.reduce((sum, fill) => sum + gtcUnits(fill.shares), 0n);
    // 只允许 exact 原单的完整 CONFIRMED 明细证明全部成交；部分/未知仍保留核对问题。
    if (complete && quantity > 0n && quantity === gtcUnits(plan.shares) && confirmed.every(fill => fill.status === "CONFIRMED")) {
      return { order: { id, original: plan.shares, matched: gtcDecimal(quantity), status: "MATCHED", tradeIds: [...new Set(ownFills.map(fill => fill.tradeId))], source: "confirmed-trades" }, fills: ownFills, complete: true, observedAt: Date.now() };
    }
    return { order: null, fills: ownFills, complete: false, observedAt: Date.now(), error: orderError };
  }
  const associated = order.associate_trades;
  // 官方将 associate_trades 标为可选；缺省时仍由完整分页和累计量核对成交。
  if (associated !== undefined && !Array.isArray(associated))
    throw new Error("GTC 原单关联 tradeId 字段格式无效");
  const error = status === "INVALID" ? "PM 返回订单无效（INVALID），剩余挂单与成交仍需核实" : !complete ? "GTC 成交分页截断" : "";
  return { order: { id, original: String(order.original_size), matched: String(order.size_matched), status, tradeIds: (associated ?? []).map(String) }, fills: [...fills.values()], complete: complete && !error, observedAt: Date.now(), ...(error ? { error } : {}) };
}
