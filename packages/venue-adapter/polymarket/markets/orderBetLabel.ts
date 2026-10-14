import type { PolymarketMarketIndexEntry } from "@changmen/api-contract";
import { parseJsonArray, polymarketOrderContextFromMarket, type PolymarketRawMarket } from "./parse";

// [changmen 扩展] 订单盘口只认 PM 原生市场元数据；合场 Map（含决胜局投影）不进入此缓存。
const labels = new Map<string, string>();
const MAX_LABELS = 5000;

function remember(conditionId: string, tokenIds: string[], label: string): void {
  if (!conditionId || !label)
    return;
  for (const tokenId of tokenIds.filter(Boolean)) {
    const key = JSON.stringify([conditionId.toLowerCase(), tokenId]);
    labels.delete(key);
    labels.set(key, label);
  }
  while (labels.size > MAX_LABELS)
    labels.delete(labels.keys().next().value!);
}

export function rememberPolymarketIndexBetLabel(entry: PolymarketMarketIndexEntry): void {
  const map = Number(entry.map);
  if (entry.map == null || !Number.isSafeInteger(map) || map < 0)
    return;
  remember(String(entry.marketId), [String(entry.homeTokenId), String(entry.awayTokenId)], map === 0 ? "全场" : `地图${map}`);
}

export function rememberPolymarketMarketBetLabel(market: PolymarketRawMarket): void {
  const tokens = parseJsonArray(market.clobTokenIds ?? market.clob_token_ids);
  if (!tokens.length)
    tokens.push(...(market.tokens ?? []).map(token => String(token.token_id ?? "")).filter(Boolean));
  remember(String(market.conditionId ?? market.condition_id ?? "").trim(), tokens, polymarketOrderContextFromMarket(market).bet);
}

/** 未取得 PM 元数据返回空；不能拿合场名称当 PM 盘口事实。 */
export function lookupPolymarketOrderBetLabel(conditionId: string | undefined, tokenId: string | undefined): string {
  return labels.get(JSON.stringify([String(conditionId ?? "").trim().toLowerCase(), String(tokenId ?? "").trim()])) ?? "";
}
