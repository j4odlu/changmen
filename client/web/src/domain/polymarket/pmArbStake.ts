/**
 * [changmen 扩展] 编排层 Plan CNY 换算辅助（anyOdds / 补单）。
 * 套利预检与 A8 相同：GetOrderOptions 计划额 + 并行 checkBetting，预检后不改 betMoney。
 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";
import { resolvePlanCnyFromVenueStake } from "@changmen/venue-browser/adapter/adaptation";

export type PmA8LegPair = {
  pmLeg: BetOption;
  a8Leg: BetOption;
  pmAccount?: PlatformAccount;
  a8Account?: PlatformAccount;
};

export function splitPmA8Legs(
  legA: BetOption,
  legB: BetOption,
  accountA?: PlatformAccount,
  accountB?: PlatformAccount,
): PmA8LegPair {
  if (legA.type === PLATFORMS.Polymarket) {
    return { pmLeg: legA, a8Leg: legB, pmAccount: accountA, a8Account: accountB };
  }
  return { pmLeg: legB, a8Leg: legA, pmAccount: accountB, a8Account: accountA };
}

/** 场馆 stake → Plan CNY（编排层统一入口，PM 走 U 策略） */
export function legStakeCny(
  betMoney: number,
  legType: BetOption["type"],
  account?: PlatformAccount,
): number {
  if (account && legType === PLATFORMS.Polymarket)
    return resolvePlanCnyFromVenueStake(account, betMoney);
  return betMoney;
}

/** anyOdds / 补单：成功腿场馆 stake → CNY，再算对侧 hedge */
export function hedgeStakeCnyFromLeg(
  successOdds: number,
  successBetMoney: number,
  successLegType: BetOption["type"],
  targetOdds: number,
  successAccount?: PlatformAccount,
): number {
  if (!successOdds || !targetOdds)
    return 0;
  const successCny = legStakeCny(successBetMoney, successLegType, successAccount);
  return Math.floor((successOdds * successCny) / targetOdds);
}
