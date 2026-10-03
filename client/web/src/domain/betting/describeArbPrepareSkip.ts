import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { PlatformId } from "@/types/esport";
import type { UserConfig } from "@/types/userConfig";
import { pickArbLegs } from "@changmen/arb-core";
import { arbProfitRate } from "@changmen/client-core/shared/format";
import { formatAccountFundingHint } from "@/stores/account/accountPicker";

/** 主循环扫描阶段跳过（未选出双腿，不应发套利执行 Telegram） */
export function isArbScanSkipSummary(summary: string): boolean {
  return /利润\/赔率未达|无余额|仅 .+ 有余额|尚未加载|补单队列/.test(summary);
}

/** getOrderOptions 失败时的可读原因（不改变 A8 判定，仅用于进度报告文案） */
export function describeGetOrderOptionsSkip(
  bet: ViewBet,
  match: ViewMatch,
  config: UserConfig,
  providerKeys: PlatformId[],
  accounts: PlatformAccount[],
): string {
  if (!providerKeys.length) {
    const anyLoaded = accounts.some(a => a.getBalance() !== undefined);
    if (!anyLoaded && accounts.length) {
      return "账号余额尚未加载（请等待刷新或点账号栏刷新）";
    }
    const threshold = config.betMoneyMode === "total" ? 0 : config.betMoney;
    const hint = formatAccountFundingHint(accounts, threshold);
    return `无余额 ≥ ${threshold} 的账号平台（${hint}）`;
  }
  if (providerKeys.length === 1) {
    return `仅 ${providerKeys[0]} 有余额账号，套利需至少两个不同平台`;
  }

  const legs = pickArbLegs(bet, config, providerKeys, accounts, match.game);
  if (!legs) {
    return `利润/赔率未达阈值（要求对冲 ≥ ${arbProfitRate(config.profit)}，minOdds ≥ ${config.minOdds}）`;
  }

  return "无法构建双腿订单";
}
