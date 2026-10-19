import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBet } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueLegOutcome } from "@changmen/venue-browser/adapter/contract";
import { isVenueLegRejected } from "@changmen/venue-browser/adapter/contract";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
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
  bindArbOrderId,
  refreshOrderListAfterBind,
  resolveArbBindOrderId,
} from "@/stores/betting/arbOrderBind";
import { enqueuePendingOrderBind } from "@/stores/betting/pendingOrderBind";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { useMessageStore } from "@/stores/messageStore";
import { consumeMakeUpQueue, useLoseOrderStore } from "@/stores/loseOrderStore";

const observationRetries = new WeakSet<LoseOrder>();

/** [changmen 扩展] 原单查询只使用发起时的账号与会话；撤销后停止旁路核验。 */
export function makeUpObservationScope(account: PlatformAccount): () => boolean {
  const session = getAuthSessionVersion();
  const { accountId, provider, token, gateway } = account;
  return () => {
    const current = useAccountStore().findAccount(accountId);
    return isAuthSessionCurrent(session) && Boolean(current && current.provider === provider
      && current.token === token && current.gateway === gateway);
  };
}

export function isMakeUpObservationRetrying(order: LoseOrder): boolean {
  return observationRetries.has(order);
}

/** [changmen 扩展] 查询异常与仍待确认共用一个续查任务；只核验原单，不发送新下注。 */
export function continueMakeUpObservation(
  order: LoseOrder,
  scopeCurrent: () => boolean,
  observe: () => Promise<boolean>,
): void {
  if (observationRetries.has(order))
    return;
  observationRetries.add(order);
  const run = async () => {
    if (!scopeCurrent()) {
      observationRetries.delete(order);
      return;
    }
    let pending = false;
    try { pending = await observe(); }
    catch { /* 查询异常由检测入口返回 pending；其它收尾异常不能重新计数或重开已完成原单。 */ }
    if (pending && scopeCurrent())
      setTimeout(() => { void run(); }, 1_000);
    else
      observationRetries.delete(order);
  };
  setTimeout(() => { void run(); }, 1_000);
}

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
  bet: Pick<ViewBet, "id">;
  account: PlatformAccount;
  checked: BetOption;
  result: BetResult;
  waitSec: number;
  accountStore: ReturnType<typeof useAccountStore>;
  removeIds: Set<number>;
  setMessage: (msg: string) => void;
  /** [changmen 扩展] 已受理原单的刷新恢复，即使剩余等待为 0 也要完成原检测。 */
  resumeAccepted?: boolean;
}): Promise<boolean> {
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

  const loseStore = useLoseOrderStore();
  const isCurrentOrder = () => loseStore.orders.get(betId) === order;
  // [A8 可证实] 受理尝试收尾后计数；成功只消费一次，拒单保留队列继续下一候选。
  const finish = (rejected: boolean) => {
    try {
      markSuccessfulBet(account, bet.id, order.target);
    }
    finally {
      if (isCurrentOrder()) {
        if (rejected)
          loseStore.clearPendingVenueOrder(betId);
        else
          consumeMakeUpQueue(loseStore, order, removeIds);
      }
    }
  };

  if (!params.resumeAccepted && (order.isCreateOrder || waitSec === 0)) {
    finish(false);
    return false;
  }

  // [changmen 扩展] 原队列在受理回执到达前取消时，也保留这一笔的检测时间和结果。
  const receipt = order.pendingRegularReceipt ??= { checkAt: Date.now() + waitSec * 1000 };
  const scopeCurrent = makeUpObservationScope(account);
  if (receipt?.rejected === undefined && waitSec > 0) {
    a8Tip("拒单检测", `等待<countdown>${waitSec}</countdown>秒`, waitSec * 1000);
    syncActiveBetMakeupSettling(betId, waitSec);
  }

  let legOutcome: VenueLegOutcome | null;
  try {
    legOutcome = receipt.rejected !== undefined ? null : await resolveVenueLegOutcome(
    account,
    result,
    () => accountStore.updateVenueOrders(account, {
      pendingBindLinkId: order.linkId || undefined,
      pendingBindOrderId: String(result.orderId ?? "").trim() || undefined,
    }),
    { rejectWaitSec: waitSec },
    );
  }
  catch {
    continueMakeUpObservation(order, scopeCurrent, () => processA8RegularVenueMakeUpLeg({
      ...params,
      resumeAccepted: true,
      waitSec: Math.max(0, (receipt.checkAt - Date.now()) / 1000),
    }));
    return true;
  }
  if (isMakeUpObservationRetrying(order) && !scopeCurrent())
    return false;
  const venueOrders = legOutcome?.orders ?? [];
  // [A8 可证实] 空列表按未拒单处理；已确定结果恢复后不再读取其它最新订单改判。
  const rejected = receipt?.rejected ?? (venueOrders.length > 0 && isVenueLegRejected(legOutcome!));
  if (legOutcome) saveVenueSettlementLog({
    account,
    option: checked,
    result,
    orders: venueOrders,
    settlement: legOutcome.settlement,
    linkId: order.linkId,
  });

  const orderId = receipt?.rejected !== undefined
    ? receipt.bindOrderId
    : resolveArbBindOrderId(venueOrders, result, rejected);
  if (receipt && receipt.rejected === undefined) {
    receipt.rejected = rejected;
    receipt.bindOrderId = orderId;
    if (isCurrentOrder()) {
      try { loseStore.persist(); }
      catch { /* 保留本页已确定结果，不能因此重发。 */ }
    }
  }
  // [changmen 扩展] 绑定/补绑安排完成后，才计数并保存出队；刷新期间原回执仍可恢复。
  const bound = legOutcome
    ? await bindArbLegOrder(order.linkId, account, result, venueOrders, rejected)
    : orderId ? await bindArbOrderId(order.linkId, result.provider, account.accountId, orderId) : false;
  if (!bound && orderId) {
    enqueuePendingOrderBind({ observation: result.observation, target: checked.target,
      linkId: order.linkId, provider: result.provider, accountId: account.accountId, orderId, betId });
  }
  finish(rejected);
  if (!isCurrentOrder() && loseStore.orders.has(betId))
    return false;
  refreshOrderListAfterBind();
  if (rejected) {
    setMessage(`${order.target} 再次被拒单`);
    a8Tip("拒单提醒", `${order.target} 再次被拒单`, 3000);
    syncActiveBetMakeupRejected(betId, order.target);
  }
  else {
    syncActiveBetMakeupDone(betId, account.provider, checked.odds);
  }
  useMessageStore().loseOrderMessage(account, order, checked, rejected);
  return false;
}
