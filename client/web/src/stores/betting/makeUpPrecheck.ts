import type { BetOption } from "@changmen/client-core/models/betOption";
import type { LoseOrder } from "@/models/loseOrder";
import type { PlatformAccount } from "@/models/platformAccount";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import { legStakeCny } from "@/domain/polymarket/pmArbStake";
import { checkMakeupProfitRateCandidate, isMakeupProfitRateMode } from "@/extensions/arbBet/makeupOddsBand";

export interface MakeUpPrecheckInput {
  order: Pick<LoseOrder, "betMoney" | "betOdds">;
  checked: Pick<BetOption, "odds" | "betMoney" | "type">;
  account: PlatformAccount;
  sideOdds: number;
  useBand: boolean;
  bandPrefs?: MakeupOddsBandPrefs | null;
}

/** [changmen 扩展] 原预检后利润率门控的同步提取；调用方保留队列身份与 checked.data 检查。 */
export function passesMakeUpPrecheck(
  { order, checked, account, sideOdds, useBand, bandPrefs }: MakeUpPrecheckInput,
): boolean {
  if (useBand && bandPrefs && isMakeupProfitRateMode(bandPrefs)) {
    const checkedOdds = Number(checked.odds) || sideOdds;
    const checkedStakeCny = legStakeCny(
      checked.betMoney,
      checked.type,
      account,
    );
    const rateCheck = checkMakeupProfitRateCandidate(
      order.betMoney,
      order.betOdds,
      checkedStakeCny,
      checkedOdds,
      bandPrefs,
    );
    if (!rateCheck?.allowed)
      return false;
  }
  return true;
}
