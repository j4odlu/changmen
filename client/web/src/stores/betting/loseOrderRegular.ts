import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBet } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useAccountStore } from "@/stores/accountStore";
import { isVenueLegRejected } from "@changmen/venue-adapter/contract";
import { resolveVenueLegOutcome } from "@/domain/betting/resolveVenueLegOutcome";
import { saveVenueSettlementLog } from "@/services/bettingLog";
import { a8Tip } from "@/shared/a8Notify";
import {
  syncActiveBetMakeupDone,
  syncActiveBetMakeupRejected,
  syncActiveBetMakeupSettling,
} from "@/stores/betting/activeBetRunSync";
import {
  bindArbLegOrder,
  refreshOrderListAfterBind,
  resolveArbBindOrderId,
} from "@/stores/betting/arbOrderBind";
import { enqueuePendingOrderBind } from "@/stores/betting/pendingOrderBind";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { useMessageStore } from "@/stores/messageStore";

/**
 * [A8 可证实] bundle `jb` 普通场馆腿（index0706）：
 * - `be>0`：wait → `updateOrders()` → `orders[0].status===reject` 判拒
 * - `be===0`（waitTime=-1）：API 成功即出队，不拉场馆
 * - 拒单：不出队，内层 for 继续试下一 platform item
 * - API 返回 null/undefined：出队（`le||Z.push(z)`）
 * - 手动 `isCreateOrder`：成功即出队，无拒单复检
 */
export async function processA8RegularVenueMakeUpLeg(params: {
  betId: number;
  order: LoseOrder;
  bet: ViewBet;
  account: PlatformAccount;
  checked: BetOption;
  result: BetResult;
  waitSec: number;
  accountStore: ReturnType<typeof useAccountStore>;
  removeIds: Set<number>;
  setMessage: (msg: string) => void;
}): Promise<void> {
  const {
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
  } = params;

  if (order.isCreateOrder) {
    removeIds.add(betId);
    markSuccessfulBet(account, bet.id, order.target);
    return;
  }

  if (waitSec === 0) {
    removeIds.add(betId);
    markSuccessfulBet(account, bet.id, order.target);
    return;
  }

  if (waitSec > 0) {
    a8Tip("拒单检测", `等待<countdown>${waitSec}</countdown>秒`, waitSec * 1000);
    syncActiveBetMakeupSettling(betId, waitSec);
  }

  const legOutcome = await resolveVenueLegOutcome(
    account,
    result,
    () => accountStore.updateVenueOrders(account, {
      pendingBindLinkId: order.linkId || undefined,
      pendingBindOrderId: String(result.orderId ?? "").trim() || undefined,
    }),
    { rejectWaitSec: waitSec },
  );
  const venueOrders = legOutcome.orders;
  const rejected = isVenueLegRejected(legOutcome);
  saveVenueSettlementLog({
    account,
    option: checked,
    result,
    orders: venueOrders,
    settlement: legOutcome.settlement,
    linkId: order.linkId,
  });

  if (venueOrders.length > 0) {
    if (rejected) {
      setMessage(`${order.target} 再次被拒单`);
      a8Tip("拒单提醒", `${order.target} 再次被拒单`, 3000);
      syncActiveBetMakeupRejected(betId, order.target);
    }
    else {
      removeIds.add(betId);
      syncActiveBetMakeupDone(betId, account.provider, checked.odds);
    }
    const orderId = resolveArbBindOrderId(venueOrders, result, rejected);
    if (!(await bindArbLegOrder(order.linkId, account, result, venueOrders, rejected)) && orderId) {
      enqueuePendingOrderBind({
        observation: result.observation,
        target: checked.target,
        linkId: order.linkId,
        provider: result.provider,
        accountId: account.accountId,
        orderId,
        betId,
      });
    }
    refreshOrderListAfterBind();
  }
  else {
    removeIds.add(betId);
    syncActiveBetMakeupDone(betId, account.provider, checked.odds);
    const orderId = resolveArbBindOrderId([], result, false);
    if (!(await bindArbLegOrder(order.linkId, account, result, [], false)) && orderId) {
      enqueuePendingOrderBind({
        observation: result.observation,
        target: checked.target,
        linkId: order.linkId,
        provider: result.provider,
        accountId: account.accountId,
        orderId,
        betId,
      });
    }
    refreshOrderListAfterBind();
  }
  useMessageStore().loseOrderMessage(account, order, checked, rejected);

  markSuccessfulBet(account, bet.id, order.target);
}
