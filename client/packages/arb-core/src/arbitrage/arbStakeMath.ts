import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { UserConfig } from "@changmen/client-core/types/userConfig";

/** 两腿对冲 implied 乘数（≥1 为盈利） */
export function impliedFromLegOdds(legA: BetOption, legB: BetOption): number {
  return 1 / (1 / legA.odds + 1 / legB.odds);
}

/** [changmen 扩展] 合计模式先换算低赔腿初始金额，后续对冲与取整沿用现有规则。 */
export function initialArbBaseStake(oddsA: number, oddsB: number, config: UserConfig): number {
  if (config.betMoneyMode !== "total")
    return config.betMoney;
  const low = Math.min(oddsA, oddsB);
  const high = Math.max(oddsA, oddsB);
  return config.betMoney * high / (low + high);
}

/** 对齐 pickArbLegs：账号 profit 覆盖 config.profit */
export function resolveArbTargetProfit(
  config: UserConfig,
  legA: BetOption,
  legB: BetOption,
  accountA?: PlatformAccount,
  accountB?: PlatformAccount,
): number {
  let targetProfit = config.profit;
  const profitOverrides = [accountA, accountB].filter(
    (acc, idx) =>
      acc
      && acc.profit !== 0
      && acc.provider === (idx === 0 ? legA.type : legB.type),
  );
  if (profitOverrides.length) {
    targetProfit = Math.max(...profitOverrides.map(a => a!.profit));
  }
  return targetProfit;
}

/** GetOrderOptions 对冲金额（与 buildOrderOptions 同式；A8 仅在选腿时算一次，预检后不再重算） */
export function applyArbHedgeStakes(
  legA: BetOption,
  legB: BetOption,
  baseStake: number,
  config: UserConfig,
): void {
  const oddsA = legA.odds;
  const oddsB = legB.odds;
  if (oddsA <= oddsB) {
    legA.betMoney = baseStake;
    let hedge = (oddsA * baseStake) / oddsB;
    if (config.tenNumber)
      hedge = Math.round(hedge / 10) * 10;
    legB.betMoney = hedge;
  }
  else {
    legB.betMoney = baseStake;
    let hedge = (oddsB * baseStake) / oddsA;
    if (config.tenNumber)
      hedge = Math.round(hedge / 10) * 10;
    legA.betMoney = hedge;
  }
}

/** 主腿买入额：低赔一侧原 stake（与 prepare 时 config.betMoney 一致） */
export function arbBaseStake(legA: BetOption, legB: BetOption, config: UserConfig): number {
  if (legA.odds <= legB.odds)
    return legA.betMoney || config.betMoney;
  return legB.betMoney || config.betMoney;
}
