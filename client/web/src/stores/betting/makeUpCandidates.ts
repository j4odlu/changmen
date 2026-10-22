import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBetItem } from "@/models/match";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import type { UserConfig } from "@/types/userConfig";
import { filterMakeupOddsBandCandidates, isMakeupOddsBandEnabled } from "@/extensions/arbBet/makeupOddsBand";

export interface MakeUpCandidateInput<T> {
  order: Pick<LoseOrder, "target" | "isCreateOrder" | "betOdds" | "betMoney" | "getOdds" | "getBetMoney">;
  bet: { items: readonly T[] };
  config: Pick<UserConfig, "makeProfit">;
  bandPrefs?: MakeupOddsBandPrefs | null;
}

/** [changmen 扩展] 原候选筛选与排序的纯函数提取；保留候选引用、空列表停止和 null 回退语义。 */
export function selectMakeUpCandidates<T extends Pick<ViewBetItem, "getOdds">>(
  { order, bet, config, bandPrefs }: MakeUpCandidateInput<T>,
): { useBand: boolean; candidates: T[] } {
  const useBand = isMakeupOddsBandEnabled(bandPrefs) && !order.isCreateOrder;
  const minOdds = order.getOdds(config.makeProfit);
  const banded = useBand && bandPrefs
    ? filterMakeupOddsBandCandidates(
        [...bet.items].sort(
          (a, b) => b.getOdds(order.target) - a.getOdds(order.target),
        ),
        item => item.getOdds(order.target),
        order.betOdds,
        bandPrefs,
        {
          filledStake: order.betMoney,
          getMakeupStake: (_item, odds) => order.getBetMoney(odds),
        },
      )
    : null;
  const candidates = banded ?? bet.items
    .filter(item => item.getOdds(order.target) >= minOdds)
    .sort((a, b) => b.getOdds(order.target) - a.getOdds(order.target));

  return { useBand, candidates };
}
