import { polymarketMarketAssetIds, polymarketConditionsAgree } from "./pm_market_assets.js";

/** [changmen 扩展] Data API v2 final payouts are micro-USDC per share, never live prices. */
export function polymarketEqualSplitResolved(market) {
  const resolution = market?.finalResolution;
  const condition = market?.conditionId ?? market?.condition_id;
  const ids = polymarketMarketAssetIds(market);
  return Boolean(condition && resolution?.condition_id
    && polymarketConditionsAgree(condition, market?.conditionId, market?.condition_id, resolution.condition_id)
    && ids.length === 2 && resolution.status === "resolved"
    && Array.isArray(resolution.payouts) && resolution.payouts.length === 2
    && resolution.payouts.every(value => value === 500_000));
}

/** Only terminal-looking markets need the extra public finality read. A 0.5 quote alone is insufficient. */
export function polymarketNeedsFinalResolution(market) {
  if (!market || polymarketEqualSplitResolved(market)) return false;
  const winners = Array.isArray(market.tokens) ? market.tokens.filter(token => token?.winner === true) : [];
  return (winners.length !== 1 || market.fallbackResolutionType === "equal_split") && (market.closed === true
    || market.umaResolutionStatus === "resolved" || market.uma_resolution_status === "resolved");
}

export function polymarketWithFinalResolution(market, rows) {
  const condition = String(market?.conditionId ?? market?.condition_id ?? "").toLowerCase();
  if (!condition || !Array.isArray(rows)) return market;
  const matches = rows.filter(row => String(row?.condition_id ?? "").toLowerCase() === condition);
  if (matches.length !== 1) return market;
  const next = { ...market, finalResolution: matches[0] };
  return polymarketEqualSplitResolved(next) ? next : market;
}

export function polymarketIsEqualSplitOrder(order) {
  const value = order?.pmMatchResult ?? order?.PmMatchResult;
  return value === "equal_split" || value === "EqualSplit";
}

/** Financial status and the market outcome are separate. A flat result uses Return in storage. */
export function polymarketProfitStatus(money) {
  return money > 0 ? "win" : money < 0 ? "lose" : "return";
}

/** Remaining all-in cost already includes fees. Realized sales P&L must not include a prior paper result. */
export function polymarketEqualSplitAmounts(remainingShares, remainingCost, realizedPnl = 0) {
  if (![remainingShares, remainingCost, realizedPnl].every(value => typeof value === "number" && Number.isFinite(value))
    || remainingShares < 0 || remainingCost < 0) return null;
  const reward = Math.round(remainingShares * 0.5 * 10000) / 10000;
  const money = Math.round((realizedPnl + reward - remainingCost) * 10000) / 10000;
  return { reward, money, status: polymarketProfitStatus(money) };
}
