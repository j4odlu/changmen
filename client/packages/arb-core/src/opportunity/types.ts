import type { PlatformId } from "@changmen/api-contract";

/** fullMarket=全盘口（通知旁路）；funded=getProviders（对齐 A8 GetOrderOptions） */
export type ArbDetectScope = "fullMarket" | "funded";

/** 一次 detect 产出的单条套利机会 */
export interface ArbOpportunity {
  scope: ArbDetectScope;
  matchId: number;
  betId: number;
  matchTitle: string;
  betName: string;
  homePlatform: PlatformId;
  awayPlatform: PlatformId;
  homeOdds: number;
  awayOdds: number;
  /** 隐含利润率，与 pickArbLegs.implied 一致 */
  implied: number;
}

/** 状态机主键：同一赛事盘口 + 同一对平台腿 */
export type OpportunityKey = `${number}:${number}:${PlatformId}:${PlatformId}`;

export function opportunityKey(
  opp: Pick<ArbOpportunity, "matchId" | "betId" | "homePlatform" | "awayPlatform">,
): OpportunityKey {
  return `${opp.matchId}:${opp.betId}:${opp.homePlatform}:${opp.awayPlatform}`;
}

/** 合并 Telegram 用的盘口锚点 */
export function betAnchor(opp: Pick<ArbOpportunity, "matchId" | "betId">): string {
  return `${opp.matchId}:${opp.betId}`;
}
