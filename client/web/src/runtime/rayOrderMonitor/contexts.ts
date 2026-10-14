/** [changmen 扩展] 独立订单监控的关联及补单上下文；没有查询或定时器。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { RayOrderContext, RegisterRayOrderContextInput } from "./types";
import { saveUserLog } from "@/api/chat";
import { observeOrder } from "@/services/orderObservation";
import { rayRejectFailureEvidence } from "@/services/orderObservationEvidence";
import { useUserStore } from "@/stores/userStore";
import { useRayOrderContextStore } from "./contextStore";
import { matchRayVenueOrder } from "./match";

type RayOrderFact = Pick<VenueOrder, "orderId" | "status"> & Partial<VenueOrder>;
function log(task: RayOrderContext, event: "registered" | "bound" | "rejected" | "closed", order?: RayOrderFact): void {
  try {
    observeOrder(task.observation, task.linkId, event === "rejected" || event === "closed" ? "settlement_observed" : "decision", {
      provider: "RAY", accountId: task.accountId, orderId: order?.orderId || task.boundOrderId,
      target: task.target, outcome: event === "rejected" ? "unfilled" : event === "closed" ? "filled" : event,
      source: "ray_monitor", phase: "ray_order_monitor", observedStatus: order?.status, reasonCode: event,
      ...(event === "rejected" && order?.venueRejectReason ? rayRejectFailureEvidence(order.venueRejectReason) : {}),
    });
    void saveUserLog(`RAY订单监控 => ${event}`, {
      diagnosticVersion: 3, monitoringMode: "ray-order-monitor", monitorEvent: event,
      linkId: task.linkId, provider: "RAY", accountId: task.accountId,
      orderId: order?.orderId ?? task.boundOrderId ?? null, betId: task.betId, side: task.side,
      target: task.target, match: task.match, bet: task.bet, item: task.item, odds: task.odds,
      betMoney: task.betMoney, placedAt: task.submittedAt, observedAt: Date.now(),
      rejectDelayMs: task.rejectDelayMs ?? null, observedStatus: order?.status ?? task.lastObservedStatus ?? "missing",
    }).catch(() => {});
  }
  catch { /* 观察日志不影响原下注流程或监控。 */ }
}
/** 原首次确认完成后，只交接上下文，不查询、不修改首次拒单检测结论。 */
export function registerRayOrderContext(input: RegisterRayOrderContextInput): void {
  try {
    if (input.initialRejected || !input.linkId || !input.accountId)
      return;
    const userId = String(useUserStore().userId || "");
    if (!userId)
      return;
    const store = useRayOrderContextStore(); store.restore(userId);
    const key = `${userId}:${input.linkId}:${input.side}:${input.accountId}`;
    if (store.tasks.has(key))
      return;
    const { initialOrders, initialRejected: _initialRejected, ...context } = input;
    const now = Date.now();
    const task: RayOrderContext = { ...context, key, userId, submittedAt: input.submittedAt || now,
      status: "binding", candidateCount: 0, pollCount: 0, updatedAt: now };
    const match = matchRayVenueOrder(task, initialOrders);
    if (match.kind === "matched") {
      task.boundOrderId = match.candidate.order.orderId;
      task.submittedAt = match.candidate.order.createAt || task.submittedAt;
      task.lastObservedStatus = match.candidate.order.status;
      task.status = "watching";
    }
    else if (match.kind === "ambiguous") {
      task.status = "ambiguous";
    }
    task.candidateCount = match.candidates.length;
    store.upsert(task); log(task, "registered");
  }
  catch { /* 登记失败不能改变首次下注收尾。 */ }
}
/** 消费唯一查询返回值，关联完成后交由调用者统一保存；本函数不拉单。 */
export async function bindRayOrderContexts(account: PlatformAccount, orders: readonly VenueOrder[], current: () => boolean,
  onBound: (task: RayOrderContext, order: VenueOrder) => Promise<void>): Promise<void> {
  const store = useRayOrderContextStore();
  for (const original of store.activeTasks.filter(task => task.accountId === account.accountId)) {
    if (!current())
      return;
    const claimed = new Set([...store.tasks.values()].filter(task => task.accountId === account.accountId && task.key !== original.key && task.boundOrderId).map(task => task.boundOrderId));
    const candidates = orders.filter(order => order.provider === "RAY" && (original.boundOrderId || !claimed.has(order.orderId)));
    const match = original.boundOrderId ? undefined : matchRayVenueOrder(original, candidates);
    const order = original.boundOrderId ? candidates.find(order => order.orderId === original.boundOrderId)
      : match?.kind === "matched" ? match.candidate.order : undefined;
    const task: RayOrderContext = { ...original, pollCount: original.pollCount + 1, lastPollAt: Date.now(), updatedAt: Date.now() };
    if (!order) {
      task.status = match?.kind === "ambiguous" ? "ambiguous" : original.boundOrderId ? "watching" : "binding";
      task.candidateCount = match?.candidates.length ?? task.candidateCount;
      task.lastObservedStatus = "missing";
      store.upsert(task); continue;
    }
    task.boundOrderId = order.orderId;
    task.submittedAt = order.createAt || task.submittedAt;
    task.candidateCount = match?.candidates.length ?? task.candidateCount;
    task.status = "watching";
    store.upsert(task);
    if (!task.bindingSaved) {
      try {
        await onBound(task, order);
        if (!current())
          return;
        store.patch(task.key, { bindingSaved: true, boundAt: Date.now(), lastError: undefined });
        log(task, "bound", order);
      }
      catch (error) {
        if (current())
          store.patch(task.key, { lastError: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
      }
    }
  }
}
function dispatchMakeup(task: RayOrderContext, current: () => boolean): void {
  void import("./autoMakeup").then(({ handleRayLateRejectAutoMakeup }) => {
    if (current())
      return handleRayLateRejectAutoMakeup(task, current);
  }).catch((error) => {
    if (current())
      useRayOrderContextStore().patch(task.key, { autoMakeupStatus: "failed", autoMakeupReason: String(error), updatedAt: Date.now() });
  });
}
/** 只接纳已保存的原单事实，拒单后的业务处置继续使用原补单策略。 */
export function observeRayOrderContexts(player: number, orders: readonly RayOrderFact[], current: () => boolean): void {
  if (!current())
    return;
  const store = useRayOrderContextStore();
  for (const task of store.activeTasks.filter(task => task.accountId === player && task.boundOrderId && task.bindingSaved)) {
    const order = orders.find(order => order.orderId === task.boundOrderId);
    if (!order)
      continue;
    const now = Date.now();
    if (order.status === "reject") {
      const enabled = useUserStore().extensionPrefs?.rayLateRejectAutoMakeup?.enabled === true;
      const rejected: RayOrderContext = { ...task, status: "rejected", lastObservedStatus: "reject", rejectedAt: now,
        rejectDelayMs: Math.max(0, now - task.submittedAt), lastError: undefined, updatedAt: now,
        autoMakeupStatus: enabled ? undefined : "disabled", autoMakeupReason: enabled ? undefined : "自动补单未开启" };
      store.upsert(rejected); log(rejected, "rejected", order);
      if (enabled)
        dispatchMakeup(rejected, current);
    }
    else if (["win", "lose", "return"].includes(order.status)) {
      store.patch(task.key, { status: "closed", lastObservedStatus: order.status, lastError: undefined, updatedAt: now });
      log(task, "closed", order);
    }
    else {
      store.patch(task.key, { lastObservedStatus: order.status, lastError: undefined, updatedAt: now });
    }
  }
}
export function resumeRayContextMakeup(current: () => boolean): void {
  for (const task of useRayOrderContextStore().tasks.values()) {
    if (task.status === "rejected" && (!task.autoMakeupStatus || task.autoMakeupStatus === "enqueuing"))
      dispatchMakeup(task, current);
  }
}
