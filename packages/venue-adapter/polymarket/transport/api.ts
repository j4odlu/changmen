/**
 * Polymarket 浏览器侧端点与 WS 报文（非电竞列表 discovery）。
 *
 * Gamma/CLOB **列表扫盘**权威：`server/collectors/polymarket-esports/api.js`。
 * 本文件只保留报价通道、订单、单盘 Gamma 所需的 base URL 与 subscribe 报文。
 * Transport（direct / vps / extension）见 `pmTransportMode.ts` / `transport.ts`。
 */

export const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB_API = "https://clob.polymarket.com";
/** 官网历史 / 持仓同源（公开） */
export const POLYMARKET_DATA_API = "https://data-api.polymarket.com";
export const POLYMARKET_MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const POLYMARKET_USER_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/user";
export const POLYMARKET_SPORTS_WS = "wss://sports-api.polymarket.com/ws";

/** Sports WS `wss://sports-api.polymarket.com/ws` 推送的比赛状态消息 */
export interface PolymarketSportResult {
  gameId?: number;
  leagueAbbreviation?: string;
  slug?: string;
  homeTeam?: string;
  awayTeam?: string;
  status?: string;  // "not_started" | "running" | "finished" | "postponed" | "canceled"
  score?: string;   // "000-000|0-0|Bo3"
  period?: string;  // "1/3" | "2/3" | "3/3"
  live?: boolean;
  ended?: boolean;
  finished_timestamp?: string;
}

export interface PolymarketWsPriceChange {
  asset_id?: string;
  price?: string;
  size?: string;
  side?: string;
  best_bid?: string;
  best_ask?: string;
  hash?: string;
}

export interface PolymarketWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  timestamp?: string | number;
  hash?: string;
  // best_bid_ask event
  best_ask?: string;
  best_bid?: string;
  spread?: string;
  // book event (initial_dump snapshot)
  bids?: Array<{ price?: string | number; size?: string | number }>;
  asks?: Array<{ price?: string | number; size?: string | number }>;
  // price_change event
  price_changes?: PolymarketWsPriceChange[];
}

/**
 * @param initialDump true = 订阅后立即收到 book 快照（连接/重连时用）；
 *                    false = 仅接增量推送（60s 循环重订阅时用，避免快照洪流）。
 */
export function polymarketMarketSubscribeMessage(assetIds: string[], initialDump = true): string {
  return JSON.stringify({
    assets_ids: assetIds,
    type: "market",
    custom_feature_enabled: true,
    initial_dump: initialDump,
  });
}

/** User Channel 初次订阅（condition_id = SourceBetID） */
export function polymarketUserSubscribeMessage(
  auth: { apiKey: string; secret: string; passphrase: string },
  conditionIds: string[],
): unknown {
  return {
    auth: {
      apiKey: auth.apiKey,
      secret: auth.secret,
      passphrase: auth.passphrase,
    },
    markets: conditionIds,
    type: "user",
  };
}

/** User Channel 动态追加 condition_id */
export function polymarketUserSubscribeMoreMessage(conditionIds: string[]): unknown {
  return {
    markets: conditionIds,
    operation: "subscribe",
  };
}
