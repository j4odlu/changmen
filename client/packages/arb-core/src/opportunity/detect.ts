import type { PlatformId } from "@changmen/api-contract";
import type { ViewMatch } from "@changmen/client-core/models/match";
import type { UserConfig } from "@changmen/client-core/types/userConfig";
import { pickArbLegs } from "../arbitrage/pickArbLegs";
import type { ArbProviderScope } from "../providerKeys";
import { resolveArbProviderKeys } from "../providerKeys";
import type { ArbProfitAccount } from "../types";
import type { ArbDetectScope, ArbOpportunity, OpportunityKey } from "./types";
import { opportunityKey } from "./types";

export interface DetectOpportunitiesParams {
  matches: ViewMatch[];
  config: UserConfig;
  accounts?: ArbProfitAccount[];
  /** funded 检测：有余额 ≥ betMoney 的在线账号平台 */
  actionablePlatforms?: Iterable<PlatformId>;
}

function resolveProviderKeys(
  scope: ArbDetectScope,
  bet: ViewMatch["bets"][number],
  actionablePlatforms: Iterable<PlatformId>,
): PlatformId[] {
  const arbScope: ArbProviderScope = scope === "fullMarket" ? "display" : "auto";
  return resolveArbProviderKeys(arbScope, {
    bet,
    accountProviderKeys: actionablePlatforms,
  });
}

/** 遍历赛事列表，对每个 bet 调 pickArbLegs */
export function detectOpportunities(
  params: DetectOpportunitiesParams,
  scope: ArbDetectScope,
): ArbOpportunity[] {
  const { matches, config, accounts = [], actionablePlatforms = [] } = params;
  const out: ArbOpportunity[] = [];

  for (const match of matches) {
    for (const bet of match.bets) {
      const providerKeys = resolveProviderKeys(scope, bet, actionablePlatforms);
      if (scope === "funded" && !providerKeys.length)
        continue;

      const legs = pickArbLegs(bet, config, providerKeys, accounts, match.game);
      if (!legs)
        continue;

      out.push({
        scope,
        matchId: match.id,
        betId: bet.id,
        matchTitle: match.title,
        betName: bet.getBetName(),
        homePlatform: legs.homeItem.type,
        awayPlatform: legs.awayItem.type,
        homeOdds: legs.homeOdds,
        awayOdds: legs.awayOdds,
        implied: legs.implied,
      });
    }
  }

  return out;
}

/** 同一盘口在 funded 检测中的可执行机会（供通知旁路懒算） */
export function findFundedOpportunityForBet(
  params: DetectOpportunitiesParams,
  matchId: number,
  betId: number,
): ArbOpportunity | undefined {
  return detectOpportunities(params, "funded").find(
    o => o.matchId === matchId && o.betId === betId,
  );
}

/** 按 opportunityKey 索引，供 state diff 使用 */
export function indexOpportunities(
  opportunities: ArbOpportunity[],
): Map<OpportunityKey, ArbOpportunity> {
  const map = new Map<OpportunityKey, ArbOpportunity>();
  for (const opp of opportunities) {
    map.set(opportunityKey(opp), opp);
  }
  return map;
}
