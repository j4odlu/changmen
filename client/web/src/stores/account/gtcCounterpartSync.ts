/** [changmen 扩展] 正常拉单同步消费客户端已确认的对侧身份，保存本轮最新订单及精确关联。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { post, unwrap } from "@/api/client";
import { filterKnownGtcBuyOrders, tagKnownGtcVenueOrders } from "@/orderModes/gtc/executionProjection";
import { listLocalGtc } from "@/orderModes/gtc/localStore";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import { gtcSyncIssue } from "@/orderModes/gtc/syncStatus";

type GtcVenueOrder = VenueOrder & { pmGtcExecutionId: string };

export async function synchronizeGtcCounterparts(
  account: PlatformAccount, orders: VenueOrder[], owner: string, current: () => boolean,
): Promise<VenueOrder[]> {
  const ordinary = filterKnownGtcBuyOrders(account.accountId, orders, owner);
  // [changmen 扩展] RAY 拉单、保存和绑定与 PM 下单模式无关，统一走 Client_SaveOrder。
  if (["Polymarket", "PredictFun", "RAY"].includes(account.provider)) return ordinary;
  const tagged = tagKnownGtcVenueOrders(account.accountId, ordinary, owner);
  const candidates = tagged.filter((order): order is GtcVenueOrder => order.provider === account.provider
    && "pmGtcExecutionId" in order && typeof order.pmGtcExecutionId === "string" && Boolean(order.pmGtcExecutionId));
  if (!candidates.length) return ordinary;
  const check = () => { if (!current()) throw new Error("GTC 订单同步会话已变更"); };
  check();
  let originals: GtcVenueOrder[] = [];
  try {
    const records = await listLocalGtc(owner);
    check();
    originals = candidates.flatMap(order => {
      const matching = records.filter(row => row.owner === owner && row.id === order.pmGtcExecutionId
        && row.plan.otherPlayerId === account.accountId && row.plan.otherProvider === order.provider
        && row.other.state !== "not_attempted" && !row.other.notSent
        && row.other.orderId?.toLowerCase() === order.orderId.toLowerCase());
      return matching.length === 1 ? [{ ...order, link: matching[0]!.plan.linkId }] : [];
    });
    if (!originals.length) return ordinary;
    const origins = originals.map(order => ({ executionId: order.pmGtcExecutionId, playerId: account.accountId,
      provider: order.provider, orderId: order.orderId }));
    check();
    const saved = unwrap(await post("Pm_GtcSaveOrders", { type: account.provider, playerId: account.accountId,
      orders: JSON.stringify(originals), origins }, "", { errorTip: false }));
    check();
    if (saved !== true) throw new Error("GTC 对侧订单同步未确认成功");
    for (const order of originals) delete gtcProgress.saveIssues[order.pmGtcExecutionId!];
    const savedIds = new Set(originals.map(order => JSON.stringify([order.provider, order.orderId])));
    return ordinary.filter(order => !savedIds.has(JSON.stringify([order.provider, order.orderId])));
  }
  catch (error) {
    check();
    // 对侧关联随下轮正常同步重试；本轮其它原单仍沿用普通保存流程。
    for (const order of originals.length ? originals : candidates)
      gtcProgress.saveIssues[order.pmGtcExecutionId!] = gtcSyncIssue(error);
    return ordinary;
  }
}
