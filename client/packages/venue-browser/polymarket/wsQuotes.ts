/**
 * Polymarket CLOB market 行情解析（数据源层，无业务副作用）。
 */
import type { PolymarketWsMessage } from "./marketMessage";
import { bestAskFromBook } from "./bookQuote";

export interface PolymarketWsBidUpdate {
  assetId: string;
  /** null means an explicitly empty/invalid bid, rather than a missing field. */
  bestBid: number | null;
  timestamp?: number;
}

/** [changmen 扩展] 持仓估值读买一；不改变买入报价的 ask 解析与门控。 */
export function extractPolymarketWsBestBids(raw: string): PolymarketWsBidUpdate[] {
  return bestBidsFromMessages(parseMessages(raw));
}

function bestBidsFromMessages(messages: PolymarketWsMessage[]): PolymarketWsBidUpdate[] {
  const updates: PolymarketWsBidUpdate[] = [];
  const add = (assetId: string, bid: unknown, ts: unknown) => {
    const price = Number(bid);
    const timestamp = Number(ts);
    updates.push({ assetId, bestBid: Number.isFinite(price) && price > 0 && price < 1 ? price : null,
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {}) });
  };
  for (const msg of messages) {
    if (msg.event_type === "best_bid_ask" && msg.asset_id && msg.best_bid !== undefined) {
      add(String(msg.asset_id), msg.best_bid, msg.timestamp);
    }
    else if (msg.event_type === "price_change" && Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        if (change.asset_id && change.best_bid !== undefined)
          add(String(change.asset_id), change.best_bid, (change as { timestamp?: unknown }).timestamp ?? msg.timestamp);
      }
    }
    else if (msg.event_type === "book" && msg.asset_id && Array.isArray(msg.bids)) {
      let best = 0;
      for (const level of msg.bids) {
        const price = Number(level.price), size = Number(level.size);
        if (Number.isFinite(price) && price > best && price < 1 && Number.isFinite(size) && size > 0)
          best = price;
      }
      add(String(msg.asset_id), best, msg.timestamp);
    }
  }
  return updates;
}

export function extractPolymarketWsBestAsks(raw: string): Array<{
  assetId: string;
  bestAsk: string | number;
  timestamp?: number;
}> {
  return bestAsksFromMessages(parseMessages(raw));
}

function bestAsksFromMessages(messages: PolymarketWsMessage[]) {
  const updates: Array<{ assetId: string; bestAsk: string | number; timestamp?: number }> = [];
  for (const msg of messages) {
    const ts = Number((msg as { timestamp?: string | number }).timestamp);
    const timestamp = Number.isFinite(ts) && ts > 0 ? ts : undefined;
    if (msg.event_type === "best_bid_ask" && msg.asset_id && msg.best_ask !== undefined) {
      updates.push({ assetId: String(msg.asset_id), bestAsk: msg.best_ask, ...(timestamp ? { timestamp } : {}) });
    }
    else if (msg.event_type === "price_change" && Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        if (change.asset_id && change.best_ask !== undefined) {
          const changeTs = Number((change as { timestamp?: string | number }).timestamp);
          const rowTs = Number.isFinite(changeTs) && changeTs > 0 ? changeTs : timestamp;
          updates.push({
            assetId: String(change.asset_id),
            bestAsk: change.best_ask,
            ...(rowTs ? { timestamp: rowTs } : {}),
          });
        }
      }
    }
    else if (msg.event_type === "book" && msg.asset_id && Array.isArray(msg.asks)) {
      const bestAsk = bestAskFromBook({ asks: msg.asks });
      // 0 表示完整快照明确没有可买卖盘；缺失 asks 字段不等同于空盘。
      updates.push({ assetId: String(msg.asset_id), bestAsk, ...(timestamp ? { timestamp } : {}) });
    }
  }
  return updates;
}

function parseMessages(raw: string): PolymarketWsMessage[] {
  if (raw === "PONG") return [];
  const parsed = JSON.parse(raw) as PolymarketWsMessage | PolymarketWsMessage[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Both consumers share one JSON parse per frame on the live quote path. */
export function extractPolymarketWsQuotes(raw: string) {
  const messages = parseMessages(raw);
  return { bids: bestBidsFromMessages(messages), asks: bestAsksFromMessages(messages) };
}
