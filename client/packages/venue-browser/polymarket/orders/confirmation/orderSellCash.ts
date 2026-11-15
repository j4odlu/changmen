import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { parseTokenConfig, resolveApiCreds, resolveFunder } from "../../auth/l2Auth";
import { fetchPolymarketUserActivityTrades, matchPolymarketActivityCashByTxHashes } from "../history/pmActivity";
import { readPolymarketOrderFillEvidence } from "./orderFillReader";

const key = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

/** [changmen 扩展] FOK 卖出只按原单的完整已确认成交核对钱包净回款；不再追加扣费。 */
export async function readPolymarketSellCash(account: PlatformAccount, orderId: string, minimumShares: number,
  tokenId?: string, conditionId?: string) {
  const evidence = await readPolymarketOrderFillEvidence(account, orderId, "SELL", minimumShares);
  if (!evidence || tokenId && evidence.order.asset_id !== tokenId
    || conditionId && key(evidence.order.market) !== key(conditionId)) return null;
  const config = parseTokenConfig(account.token);
  const wallet = resolveFunder(config) || resolveApiCreds(config).address;
  if (!wallet) return null;
  const fills = new Map<string, { tx: string; shares: number }>();
  const times: number[] = [];
  for (const trade of evidence.trades) {
    const status = String(trade.status).trim().toUpperCase();
    if (/^(TRADE_STATUS_)?FAILED$/.test(status)) continue;
    const tx = key(trade.transaction_hash);
    if (!/^(TRADE_STATUS_)?CONFIRMED$/.test(status) || !/^0x[0-9a-f]{64}$/.test(tx)) return null;
    const shares = key(trade.taker_order_id) === key(orderId) ? Number(trade.size)
      : (trade.maker_orders ?? []).filter(part => key(part.order_id) === key(orderId))
        .reduce((sum, part) => sum + Number(part.matched_amount), 0);
    const id = `${key(trade.id)}:${trade.bucket_index ?? 0}`;
    const previous = fills.get(id);
    if (previous && (previous.tx !== tx || previous.shares !== shares)) return null;
    fills.set(id, { tx, shares });
    const time = Number(trade.match_time);
    if (Number.isFinite(time) && time > 0) times.push(time > 1e12 ? time / 1000 : time);
  }
  if (!fills.size) return null;
  const activity = await fetchPolymarketUserActivityTrades(wallet, { side: "SELL",
    startSec: times.length ? Math.max(0, Math.floor(Math.min(...times)) - 120) : undefined });
  const transactions = [...new Set([...fills.values()].map(fill => fill.tx))];
  const filters = { proxyWallet: wallet, conditionId: evidence.order.market, tokenId: evidence.order.asset_id };
  const total = matchPolymarketActivityCashByTxHashes(activity, transactions, filters, "SELL");
  if (!total) return null;
  for (const tx of transactions) {
    const shares = [...fills.values()].filter(fill => fill.tx === tx).reduce((sum, fill) => sum + fill.shares, 0);
    const cash = matchPolymarketActivityCashByTxHashes(activity, [tx], filters, "SELL");
    if (!cash || Math.abs(cash.shares - shares) > .000001) return null;
  }
  return { sharesSold: evidence.shares, proceedsUsdc: total.usdcSize, fillPrice: total.matchPrice };
}
