/** 原订单与全部关联成交的累计金额核对；只处理快照，不查询或修改订单。 */
import type { PolymarketTradeRow } from "../history/orderTradeTypes";
import { isPolymarketTradeConfirmed } from "../history/orderTradeProcessing";
import { round4 } from "../history/orderTradeAmounts";
import { polymarketDecimalAmount } from "@changmen/shared/pm_amounts";

export interface PolymarketFillOrderSnapshot {
  id?: string; market?: string; asset_id?: string; side?: string; status?: string;
  size_matched?: string | number; original_size?: string | number; associate_trades?: string[];
}
const key = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const terminal = new Set(["MATCHED", "CANCELED", "CANCELLED", "CANCELED_MARKET_RESOLVED", "EXPIRED"]);

export function polymarketOrderFillTradeIds(order: PolymarketFillOrderSnapshot | null | undefined, orderId: string, side: "BUY" | "SELL"): string[] | null {
  if (!order || !key(orderId) || key(order.id) !== key(orderId) || !key(order.asset_id) || !key(order.market)
    || String(order.side).trim().toUpperCase() !== side || !terminal.has(String(order.status).trim().toUpperCase())) return null;
  const matched = polymarketDecimalAmount(order.size_matched), original = polymarketDecimalAmount(order.original_size);
  if (!Number.isFinite(matched) || matched <= 0 || !Number.isFinite(original) || original <= 0 || matched > original + .000001
    || String(order.status).trim().toUpperCase() === "MATCHED" && Math.abs(matched - original) > .000001
    || !Array.isArray(order.associate_trades) || !order.associate_trades.length || order.associate_trades.some(id => !key(id))) return null;
  return [...new Set(order.associate_trades.map(key))];
}

export function polymarketOrderFillTotals(order: PolymarketFillOrderSnapshot, rows: PolymarketTradeRow[], orderId: string,
  side: "BUY" | "SELL", minimumShares = 0): { shares: number; usdc: number } | null {
  const ids = polymarketOrderFillTradeIds(order, orderId, side);
  if (!ids || !Array.isArray(rows) || !Number.isFinite(minimumShares) || minimumShares < 0) return null;
  const expected = new Set(ids), found = new Set<string>();
  const executions = new Map<string, { signature: string; shares: number; notional: number }>();
  for (const trade of rows) {
    if (!trade || !expected.has(key(trade.id)) || key(trade.market) !== key(order.market)) return null;
    const id = key(trade.id);
    const parts = key(trade.taker_order_id) === key(orderId)
      ? [{ size: trade.size, price: trade.price, asset: trade.asset_id, side: trade.side }]
      : (Array.isArray(trade.maker_orders) ? trade.maker_orders : []).filter(part => key(part?.order_id) === key(orderId))
        .map(part => ({ size: part.matched_amount, price: part.price, asset: part.asset_id, side: part.side }));
    if (!parts.length) return null;
    const failed = /^(TRADE_STATUS_)?FAILED$/i.test(String(trade.status).trim());
    if (!failed && !isPolymarketTradeConfirmed(trade.status)) return null;
    let shares = 0, notional = 0;
    for (const part of parts) {
      const size = polymarketDecimalAmount(part.size), price = polymarketDecimalAmount(part.price);
      if (key(part.asset) !== key(order.asset_id) || String(part.side).trim().toUpperCase() !== side
        || !Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0 || price >= 1) return null;
      shares += size; notional += size * price;
    }
    const bucket = trade.bucket_index ?? 0;
    if (!Number.isInteger(bucket) || bucket < 0) return null;
    const executionKey = `${id}:${bucket}`;
    const signature = JSON.stringify([failed, parts.map(part => [Number(part.size), Number(part.price), key(part.asset), String(part.side).trim().toUpperCase()]).sort()]);
    const old = executions.get(executionKey);
    if (old && old.signature !== signature) return null;
    executions.set(executionKey, { signature, shares: failed ? 0 : shares, notional: failed ? 0 : notional });
    found.add(id);
  }
  if (found.size !== expected.size) return null;
  const shares = [...executions.values()].reduce((sum, fill) => sum + fill.shares, 0);
  const usdc = [...executions.values()].reduce((sum, fill) => sum + fill.notional, 0);
  if (!Number.isFinite(shares) || !Number.isFinite(usdc) || shares <= 0 || usdc <= 0
    || Math.abs(shares - Number(order.size_matched)) > .000001 || shares + .000001 < minimumShares) return null;
  return { shares, usdc: round4(usdc) };
}
