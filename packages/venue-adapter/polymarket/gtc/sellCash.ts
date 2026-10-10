import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "../../contract";
import type { PolymarketActivityTradeRow } from "../pmActivity";
import { POLYMARKET_CLOB_API } from "../api";
import { parseTokenConfig, resolveApiCreds, resolveFunder } from "../l2Auth";
import { fetchPolymarketActivityV2 } from "../pmActivityV2";
import { polymarketL2Get } from "../transport";

interface SellTrade {
  id?: string; taker_order_id?: string; asset_id?: string; side?: string;
  size?: string; status?: string; transaction_hash?: string;
  maker_orders?: Array<{ order_id?: string; asset_id?: string; side?: string; matched_amount?: string }>;
}

/** [changmen 扩展] GTC 平仓只认本卖单的已确认交易与钱包净回款，不重复扣费。 */
export function exactGtcSellCash(trades: SellTrade[], activity: PolymarketActivityTradeRow[], orderId: string, tokenId: string, expectedShares: number): number {
  if (!Number.isFinite(expectedShares) || expectedShares <= 0 || !orderId || !tokenId)
    throw new Error("GTC 卖单份数或身份缺失，净回款待核实");
  const fills = new Map<string, { tx: string; shares: number }>();
  for (const trade of trades) {
    const parts = [];
    if (trade.taker_order_id?.toLowerCase() === orderId.toLowerCase())
      parts.push({ id: "taker", token: trade.asset_id, side: trade.side, shares: Number(trade.size) });
    for (const maker of trade.maker_orders ?? []) {
      if (maker.order_id?.toLowerCase() === orderId.toLowerCase())
        parts.push({ id: maker.order_id.toLowerCase(), token: maker.asset_id, side: maker.side, shares: Number(maker.matched_amount) });
    }
    for (const part of parts) {
      if (trade.status === "FAILED") continue;
      if (!trade.id || trade.status !== "CONFIRMED" || !trade.transaction_hash || part.token !== tokenId
        || part.side !== "SELL" || !Number.isFinite(part.shares) || part.shares <= 0)
        throw new Error("GTC 卖单成交或净回款仍待核实");
      fills.set(`${trade.id}:${part.id}`, { tx: trade.transaction_hash.toLowerCase(), shares: part.shares });
    }
  }
  const total = [...fills.values()].reduce((sum, fill) => sum + fill.shares, 0);
  if (!fills.size || Math.abs(total - expectedShares) > 0.0001)
    throw new Error("GTC 卖单确认份数不完整，净回款待核实");
  let cash = 0;
  for (const tx of new Set([...fills.values()].map(fill => fill.tx))) {
    const ownShares = [...fills.values()].filter(fill => fill.tx === tx).reduce((sum, fill) => sum + fill.shares, 0);
    const rows = activity.filter(row => row.type === "TRADE" && row.side === "SELL" && row.asset === tokenId
      && row.transactionHash?.toLowerCase() === tx);
    if (!rows.length || rows.some(row => row.usdcSize == null || !Number.isFinite(row.usdcSize) || row.usdcSize < 0
      || row.size == null || !Number.isFinite(row.size) || row.size <= 0)
      || Math.abs(rows.reduce((sum, row) => sum + Number(row.size), 0) - ownShares) > 0.0001)
      throw new Error("GTC 卖单钱包净回款未齐全，继续核实原卖单");
    cash += rows.reduce((sum, row) => sum + Number(row.usdcSize), 0);
  }
  return Math.round(cash * 10000) / 10000;
}

export async function readGtcSellCash(account: PlatformAccount, sell: VenueOrder): Promise<number> {
  const config = parseTokenConfig(account.token);
  const wallet = resolveFunder(config) || resolveApiCreds(config).address;
  if (!wallet || !sell.pmTokenId) throw new Error("GTC 卖单钱包或资产缺失，净回款待核实");
  const since = Math.max(0, Math.floor(sell.createAt / 1000) - 120);
  const trades: SellTrade[] = []; const seen = new Set<string>();
  let cursor = "MA==";
  for (let page = 0; page < 50; page++) {
    if (seen.has(cursor)) throw new Error("GTC 卖单成交分页重复");
    seen.add(cursor);
    const query = new URLSearchParams({ asset_id: sell.pmTokenId, after: String(since), next_cursor: cursor });
    const result = await polymarketL2Get<{ data?: SellTrade[]; next_cursor?: string }>(account,
      `${String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "")}/data/trades?${query}`, "/data/trades");
    if (!Array.isArray(result.data) || !result.next_cursor) throw new Error("GTC 卖单成交分页不完整");
    trades.push(...result.data); cursor = result.next_cursor;
    if (cursor === "LTE=") {
      const activity = await fetchPolymarketActivityV2(wallet, { side: "SELL", startSec: since });
      return exactGtcSellCash(trades, activity, sell.orderId, sell.pmTokenId, Number(sell.pmShares));
    }
  }
  throw new Error("GTC 卖单成交分页未完成");
}
