/**
 * PredictFun Sources 扩展：把 platform_bets.MarketID（或 Index token 映射）
 * 投影为 GetMatchs 的 HomeMarketID / AwayMarketID。
 */
import { readPredictFunMarketIndex } from "@changmen/storage/predictfun_market_index";

let _pfTokenMarketCache = { updatedAt: -1, byToken: new Map() };

/** @param {string} tokenId */
export function predictFunMarketIdByToken(tokenId) {
  const tok = String(tokenId || "").trim();
  if (!tok)
    return "";
  const index = readPredictFunMarketIndex();
  const updatedAt = Number(index?.updatedAt) || 0;
  if (updatedAt !== _pfTokenMarketCache.updatedAt) {
    const byToken = new Map();
    for (const entry of index?.entries || []) {
      const homeMid = String(entry.homeMarketId || "").trim();
      const awayMid = String(entry.awayMarketId || homeMid).trim();
      const homeTok = String(entry.homeTokenId || "").trim();
      const awayTok = String(entry.awayTokenId || "").trim();
      if (homeTok && homeMid)
        byToken.set(homeTok, homeMid);
      if (awayTok && awayMid)
        byToken.set(awayTok, awayMid);
    }
    _pfTokenMarketCache = { updatedAt, byToken };
  }
  return _pfTokenMarketCache.byToken.get(tok) || "";
}

/** @internal 测试用 */
export function __resetPfTokenMarketCacheForTests() {
  _pfTokenMarketCache = { updatedAt: -1, byToken: new Map() };
}

/**
 * @param {Record<string, unknown>} src 已含 HomeID/AwayID 的 Source
 * @param {{ MarketID?: string, SourceHomeID?: string, SourceAwayID?: string }} b platform bet 行
 * @param {(tokenId: string) => string} [lookupByToken]
 */
export function attachPredictFunMarketIds(src, b, lookupByToken = predictFunMarketIdByToken) {
  const homeId = String(src.HomeID || b?.SourceHomeID || "");
  const awayId = String(src.AwayID || b?.SourceAwayID || "");
  const betMid = String(b?.MarketID || "").trim();
  const homeMid = betMid || lookupByToken(homeId);
  const awayMid = betMid || lookupByToken(awayId) || homeMid;
  if (homeMid)
    src.HomeMarketID = homeMid;
  if (awayMid)
    src.AwayMarketID = awayMid;
  return src;
}
