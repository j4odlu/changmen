import type { PlatformId } from "@changmen/api-contract";
import type { BetSide, ViewBet, ViewBetItem } from "@changmen/client-core/models/match";
import type { UserConfig } from "@changmen/client-core/types/userConfig";
import type { ArbProfitAccount } from "../types";

/** 套利检测选出的两腿（与 A8 `GetOrderOptions` 选腿逻辑一致，不含下注排序） */
export interface ArbLegs {
  homeItem: ViewBetItem;
  awayItem: ViewBetItem;
  homeOdds: number;
  awayOdds: number;
  implied: number;
}

/** [A8 可证实] bundle `IQ.isBet` 为空实现；GetOrderOptions 不因 noSameBet 在此阶段排除平台 */
function isBetStub(): boolean {
  return false;
}

/**
 * 检测是否满足套利阈值（profit～maxProfit、minOdds、平台过滤等）。
 * 对齐 A8 `IQ.GetOrderOptions` 选腿；是否实际下单由 `config.betting` 控制。
 */
export function pickArbLegs(
  bet: ViewBet,
  config: UserConfig,
  providerKeys: PlatformId[],
  accounts: ArbProfitAccount[] = [],
  _gameName?: string,
): ArbLegs | undefined {
  if (!config)
    return undefined;

  const allowSame = new Set(config.allowSameBet ?? []);
  const oddsOf = (item: ViewBetItem, side: BetSide) => item.getOdds(side);

  const homeCandidates = bet.items.filter((v) => {
    if (config.noSameBet && !allowSame.has(v.type) && isBetStub()) {
      return false;
    }
    const homeOdds = oddsOf(v, "Home");
    return Boolean(homeOdds && homeOdds >= config.minOdds && providerKeys.includes(v.type));
  });
  const homeItem = homeCandidates.reduce<ViewBetItem | undefined>((best, cur) => {
    const odds = oddsOf(cur, "Home");
    if (!best || odds > oddsOf(best, "Home"))
      return cur;
    return best;
  }, undefined);

  const awayCandidates = bet.items.filter((v) => {
    if (homeItem && homeItem.type === v.type)
      return false;
    if (config.noSameBet && !allowSame.has(v.type) && isBetStub()) {
      return false;
    }
    const awayOdds = oddsOf(v, "Away");
    return Boolean(awayOdds && awayOdds >= config.minOdds && providerKeys.includes(v.type));
  });
  const awayItem = awayCandidates.reduce<ViewBetItem | undefined>((best, cur) => {
    const odds = oddsOf(cur, "Away");
    if (!best || odds > oddsOf(best, "Away"))
      return cur;
    return best;
  }, undefined);

  if (!homeItem || !awayItem)
    return undefined;

  const homeOdds = oddsOf(homeItem, "Home");
  const awayOdds = oddsOf(awayItem, "Away");
  const implied = 1 / (1 / homeOdds + 1 / awayOdds);

  let targetProfit = config.profit;
  const profitOverrides = accounts.filter(
    a =>
      a.profit !== 0
      && (a.provider === homeItem.type || a.provider === awayItem.type),
  );
  if (profitOverrides.length) {
    targetProfit = Math.max(...profitOverrides.map(a => a.profit));
  }
  if (implied < targetProfit || implied > config.maxProfit)
    return undefined;

  return { homeItem, awayItem, homeOdds, awayOdds, implied };
}

export function arbLegSide(
  legs: ArbLegs | undefined,
  item: ViewBetItem,
  side: BetSide,
): boolean {
  if (!legs)
    return false;
  if (side === "Home")
    return legs.homeItem.type === item.type;
  return legs.awayItem.type === item.type;
}
