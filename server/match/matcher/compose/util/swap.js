/** 对调 Source 主客侧 */
export function swapBetSource(src) {
  if (!src || typeof src !== "object")
    return src;
  return {
    ...src,
    HomeID: src.AwayID,
    AwayID: src.HomeID,
    HomeOdds: src.AwayOdds,
    AwayOdds: src.HomeOdds,
    HomeMarketID: src.AwayMarketID ?? src.HomeMarketID,
    AwayMarketID: src.HomeMarketID ?? src.AwayMarketID,
  };
}
