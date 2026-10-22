import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useAccountStore } from "@/stores/accountStore";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { processPmMakeUpLeg } from "@/stores/betting/loseOrderPm";
import { processA8RegularVenueMakeUpLeg } from "@/stores/betting/loseOrderRegular";

export interface AcceptedMakeUpLegContext {
  betId: number;
  order: LoseOrder;
  match: ViewMatch;
  bet: ViewBet;
  item: Pick<ViewBetItem, "type">;
  account: PlatformAccount;
  checked: BetOption;
  result: BetResult;
  isCurrentOrder: boolean;
  waitSec: number;
  accountStore: ReturnType<typeof useAccountStore>;
  loseStore: ReturnType<typeof useLoseOrderStore>;
  removeIds: Set<number>;
  setMessage: (msg: string) => void;
}

/** [changmen 扩展] 原受理回执保存与确认分流；直接返回原确认 Promise，调用方仍在原位置等待。 */
export function completeAcceptedMakeUpLeg({
  betId, order, match, bet, item, account, checked, result, isCurrentOrder,
  waitSec, accountStore, loseStore, removeIds, setMessage,
}: AcceptedMakeUpLegContext): Promise<void | boolean> {
  if (isCurrentOrder && !isPendingConfirmVenueProvider(account.provider) && !order.isCreateOrder && waitSec !== 0) {
    try {
      loseStore.setPendingVenueOrder(betId, String(result.orderId ?? ""), account.accountId, {
        role: "target", pendingTarget: order.target, observation: checked.observation,
        conditionId: String(checked.betId ?? ""), submittedAt: result.beginTime,
        odds: checked.odds, betMoney: checked.betMoney,
        regularReceipt: { checkAt: Date.now() + waitSec * 1000 },
      });
    }
    catch { /* 已受理回执仍在本页继续收尾，存储失败不得重发。 */ }
  }

  // [A8 可证实] 手动队列、waitTime=-1：接口成功即完成本次消费，不做拒单复检。
  if (isPendingConfirmVenueProvider(account.provider) && (!isCurrentOrder || (!order.isCreateOrder && waitSec !== 0))) {
    // [changmen 扩展] 受理回执先保存原单 ID；刷新后只核验原单，不能再次发送补单。
    if (isCurrentOrder) {
      try {
        loseStore.setPendingVenueOrder(betId, String(result.orderId ?? ""), account.accountId, {
          role: "target", pendingTarget: order.target, observation: checked.observation,
          conditionId: String(checked.betId ?? ""), submittedAt: result.beginTime,
          pmSubmission: isPolymarketProvider(account.provider) ? pmSubmissionFromResult(result, account.accountId) : null,
          odds: checked.newOdds || checked.odds, betMoney: checked.betMoney,
        });
      }
      catch { /* 存储失败不能丢弃已经受理的订单回执。 */ }
    }
    return processPmMakeUpLeg({
      betId,
      order,
      match,
      bet,
      account,
      checked,
      result,
      platformLabel: item.type,
      loseStore,
      removeIds,
      setMessage,
    });
  }

  return processA8RegularVenueMakeUpLeg({
    betId,
    order,
    bet,
    account,
    checked,
    result,
    waitSec,
    accountStore,
    removeIds,
    setMessage,
  });
}
