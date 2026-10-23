import type { BetOption } from "@changmen/client-core/models/betOption";

export interface BettingEventPayload {
  provider: BetOption["type"];
  matchId: NonNullable<BetOption["match"]>["id"];
  betId: NonNullable<BetOption["bet"]>["id"];
  target: BetOption["target"];
  betMoney: number;
  odds: number;
}

/** [changmen 扩展] 仅保留原广播字段，待确认恢复不依赖已销毁的比赛/盘口对象。 */
export function captureBettingEventPayload(option: BetOption): BettingEventPayload | undefined {
  if (!option.match || !option.bet) return undefined;
  return { provider: option.type, matchId: option.match.id, betId: option.bet.id,
    target: option.target, betMoney: option.betMoney, odds: option.odds };
}
