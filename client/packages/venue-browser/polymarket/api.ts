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

export type { PolymarketWsPriceChange, PolymarketWsMessage } from "./marketMessage";

/**
 * 初始 market 帧；官方连接运行中增减资产使用 operation 更新。
 * initialDump=false 保留给现有 CHANGMEN 转发及其他调用方。
 */
export function polymarketMarketSubscribeMessage(assetIds: string[], initialDump = true): string {
  return JSON.stringify({
    assets_ids: assetIds,
    type: "market",
    custom_feature_enabled: true,
    initial_dump: initialDump,
  });
}

/** 官方 Market WS 的资产差集更新；新增资产由官方返回初始 book。 */
export function polymarketMarketSubscriptionUpdateMessage(
  assetIds: string[],
  operation: "subscribe" | "unsubscribe",
): string {
  return JSON.stringify({
    assets_ids: assetIds,
    operation,
    ...(operation === "subscribe" ? { custom_feature_enabled: true } : {}),
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
