import type { BetOption } from "@changmen/client-core/models/betOption";
/** [changmen 扩展] GTC V1：定量限价签单、单次发送及原单事实读取；不调用 FOK settlement。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { GtcFacts, GtcFeeProof, GtcFill, GtcPlan } from "@changmen/shared/pm_gtc";
import type { PolymarketOrderClientRuntime } from "../pmOrderClientCache";
import type { GtcBuyCheckData } from "./contract";
import { gtcDecimal, gtcUnits } from "@changmen/shared/pm_gtc";
import { POLYMARKET_CLOB_API } from "../api";
import { parseTokenConfig, resolveApiCreds } from "../l2Auth";
import { pmCancelOrder, pmGetOrder, pmSubmitOrder } from "../pmClientApi";
import { resolvePmOrderSubmitHttpMode } from "../pmOrderSubmitMode";
import { pmSignedOrderHash, pmSubmitMaker } from "../pmSubmitJournal";
import { polymarketL2Get, polymarketPluginGet } from "../transport";
import { warmPolymarketUserWs } from "../userWs";
import { resolveGtcFillFee } from "./fee";
import { prepareManualGtcBuy } from "./preparation";

export { pmCancelOrder, pmSubmitMaker };
export { resolveGtcFillFee } from "./fee";
export { checkGtcBuy, checkManualGtcBuy, prepareManualGtcBuy } from "./preparation";

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
  consume: () => void;
}) {
  warmPolymarketUserWs(account, option.betId);
  const { data, runtime } = prepared;
  const market = await polymarketPluginGet<{ fd?: { r?: unknown; e?: unknown; to?: unknown } }>(`${POLYMARKET_CLOB_API}/clob-markets/${encodeURIComponent(option.betId)}`);
  const fd = market?.fd;
  if (!fd || fd.r == null || !Number.isFinite(Number(fd.r)) || Number(fd.r) < 0 || Number(fd.e) !== 1 || fd.to !== true)
    throw new Error("GTC 无法确认市场费率或不支持当前费用曲线");
  const feeProof: GtcFeeProof = { rate: decimal(Number(fd.r)), exponent: 1, takerOnly: true, observedAt: Date.now() };
  const budget = data.apiBetMoney;
  // p(1-p) ≤ 1/4；预留每份五位小数舍入上界，固定份数只向下取两位。
  const target = budget / data.limitPrice;
  const size = Math.floor(budget / (data.limitPrice + Number(fd.r) / 4 + 0.00001) * 100) / 100;
  if (!(size >= data.orderOptions.minOrderSize))
    throw new Error("GTC 含费用预算不足最小份数");
  const signed = await runtime.builder.buildOrder({ tokenID: data.tokenId, price: data.limitPrice, size, side: runtime.clob.Side.BUY, builderCode: runtime.builderCode }, { tickSize: data.orderOptions.tickSize, negRisk: data.orderOptions.negRisk } as Parameters<typeof runtime.builder.buildOrder>[1], data.orderOptions.version);
  if (!runtime.clob.isV2Order(signed))
    throw new Error("GTC SDK 未生成受支持签单");
  const shares = gtcDecimal(BigInt(signed.takerAmount));
  const maxPrincipal = gtcDecimal(BigInt(signed.makerAmount));
  if (Number(shares) !== size || Number(maxPrincipal) + size * (Number(fd.r) / 4 + 0.00001) > budget + 0.000001)
    throw new Error("GTC 实际签单数量或预算越界");
  const hash = pmSignedOrderHash(signed, { version: data.orderOptions.version, negRisk: data.orderOptions.negRisk });
  const body = runtime.clob.orderToJsonV2(signed, resolveApiCreds(parseTokenConfig(account.token)).apiKey, runtime.clob.OrderType.GTC, false, false);
  return { shares, targetShares: decimal(target), price: decimal(data.limitPrice), maxPrincipal, allInBudget: decimal(budget), feeProof, protocol: data.orderOptions.version, negRisk: data.orderOptions.negRisk, orderHash: hash, route: resolvePmOrderSubmitHttpMode(), validate: prepared.validate, submit: async () => { prepared.consume(); return pmSubmitOrder<GtcAck>(account, body); } };
}
export interface GtcAck { success?: boolean; orderID?: string; status?: string; errorMsg?: string; pmSubmitNotSent?: boolean }
interface Trade { id?: string; taker_order_id?: string; asset_id?: string; side?: string; size?: string; price?: string; status?: string; last_update?: string; match_time?: string; fee_rate_bps?: string; maker_orders?: Array<{ order_id?: string; asset_id?: string; side?: string; matched_amount?: string; price?: string }> }

export function gtcTradeFills(trade: Trade, plan: GtcPlan, id: string): GtcFill[] {
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
    const shares = gtcDecimal(gtcUnits(part.shares)); const price = gtcDecimal(gtcUnits(part.price));
    const q = Number(shares); const p = Number(price);
    const status = String(trade.status ?? "").toUpperCase();
    if (!["MATCHED", "MINED", "CONFIRMED", "RETRYING", "FAILED"].includes(status))
      throw new Error("GTC 成交状态未知");
    const timestamp = Number(trade.last_update || trade.match_time);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
      throw new Error("GTC 成交时间缺失");
    const resolvedFee = resolveGtcFillFee(plan.feeProof, part.role, q, p);
    const fee = resolvedFee == null ? null : decimal(resolvedFee);
    return { key: `${trade.id}:${part.bucket}`, tradeId: trade.id!, bucket: part.bucket, role: part.role, shares, price, fee, status, updatedAt: timestamp < 1e12 ? timestamp * 1000 : timestamp };
  });
}

/** 不完整分页、查单失败都保持未知；只按 exact orderId 聚合 maker 明细。 */
export async function readGtcFacts(account: PlatformAccount, plan: GtcPlan, id: string, since: number): Promise<GtcFacts> {
  let order: Record<string, unknown> | null = null;
  let orderError = "GTC 本次原单查询未返回记录";
  try { order = await pmGetOrder<Record<string, unknown> | null>(account, id); }
  catch (error) { orderError = error instanceof Error ? error.message : "GTC 原单查询失败"; }
  if (order && String(order.id ?? "").toLowerCase() !== id.toLowerCase())
    throw new Error("GTC 原单身份不一致");
  if (order && (String(order.asset_id) !== plan.tokenId || String(order.side).toUpperCase() !== "BUY"))
    throw new Error("GTC 原单资产或方向不一致");
  if (order && !["LIVE", "DELAYED", "MATCHED", "UNMATCHED", "CANCELED", "CANCELLED", "EXPIRED", "REJECTED"].includes(String(order.status).toUpperCase()))
    throw new Error("GTC 原单状态不支持，需人工核实");
  const fills = new Map<string, GtcFill>(); const seen = new Set<string>();
  let cursor = "MA=="; let complete = false;
  for (let page = 0; page < 50; page++) {
    if (seen.has(cursor))
      throw new Error("GTC 成交分页游标重复");
    seen.add(cursor);
    const query = new URLSearchParams({ after: String(Math.floor(since / 1000) - 60), next_cursor: cursor });
    const result = await polymarketL2Get<{ data?: Trade[]; next_cursor?: string }>(account, `${String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "")}/data/trades?${query}`, "/data/trades");
    if (!Array.isArray(result?.data) || typeof result.next_cursor !== "string")
      throw new Error("GTC 成交分页响应不完整");
    for (const trade of result.data) {
      for (const fill of gtcTradeFills(trade, plan, id)) fills.set(fill.key, fill);
    }
    cursor = result.next_cursor;
    if (cursor === "LTE=") { complete = true; break; }
  }
  const ownFills = [...fills.values()];
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
  if (!Array.isArray(associated))
    throw new Error("GTC 原单关联 tradeId 字段缺失");
  return { order: { id, original: String(order.original_size), matched: String(order.size_matched), status: String(order.status).toUpperCase(), tradeIds: associated.map(String) }, fills: [...fills.values()], complete, observedAt: Date.now(), ...(!complete ? { error: "GTC 成交分页截断" } : {}) };
}
