import type { UserConfig } from "@/types/userConfig";
import { normalizeObSingleBetMoney } from "@/types/extensionPrefs";

/** [changmen 扩展] 沿用原随机区间：启用时，prepare 已将本次随机金额写入 betMoney。 */
function independentObAmount(config: UserConfig, obSingleBetMoney: unknown): number {
  if (config.minMoney !== 0 && config.maxMoney !== 0)
    return 0;
  return normalizeObSingleBetMoney(obSingleBetMoney);
}

/** 仅对本次选中的含 OB 组合替换初始金额；后续赔率分配、加仓和账号比例保持原链路。 */
export function obSingleStakeConfig(config: UserConfig, obSingleBetMoney: number, containsOb: boolean): UserConfig {
  const amount = containsOb ? independentObAmount(config, obSingleBetMoney) : 0;
  return amount > 0 ? { ...config, betMoney: amount } : config;
}

/** 两种金额均可能被选中，不能在选腿前用较大的普通买入额排除独立小额账户。 */
export function obSingleFundingThreshold(config: UserConfig, obSingleBetMoney: number | undefined, threshold: number): number {
  const amount = independentObAmount(config, obSingleBetMoney);
  return amount > 0 ? Math.min(threshold, amount) : threshold;
}
