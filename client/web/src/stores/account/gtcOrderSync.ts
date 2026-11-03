/** [changmen 扩展] GTC 结果同步只消费本地已确认结果队列，不查询场馆或控制发送/撤单。 */
import { onScopeDispose, watch } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { finishGtcResult, listLocalGtc, listenLocalGtcChanges, localGtcChanges, pendingGtcResults } from "@/orderModes/gtc/localStore";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import { gtcSyncIssue } from "@/orderModes/gtc/syncStatus";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { registerOrderSyncProjection } from "@/api/order";
import { rememberGtcOrderIdentity } from "@/orderModes/gtc/executionProjection";
import { synchronizeGtcCounterparts } from "./gtcCounterpartSync";
import { listStoredGtcOrders } from "@/orderModes/gtc/orderStore";
import { gtcOrders } from "@/orderModes/gtc/orderState";
import { rememberGtcOrderReference } from "@/orderModes/gtc/executionProjection";

let owner = "";
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> | undefined;
let dispose: (() => void) | undefined;
let stopListening: (() => void) | undefined;
let stopProjection: (() => void) | undefined;
let refreshRevision = 0;
let refreshedRevision = 0;

export function flushGtcResults(): Promise<void> {
  if (pending) return pending;
  if (!owner) return Promise.resolve();
  const userId = owner; const stamp = generation; const session = getAuthSessionVersion();
  const current = () => stamp === generation && owner === userId && isAuthSessionCurrent(session);
  const task = (async () => {
    for (const entry of await pendingGtcResults(userId)) {
      if (!current()) return;
      if (entry.at > Date.now()) continue;
      try {
        const saved = unwrap(await post("Pm_GtcSyncResult", { result: entry.result }, "", { errorTip: false }));
        if (saved !== true) throw new Error("GTC 订单结果同步未确认成功");
        if (!current()) return;
        await finishGtcResult(entry);
        if (!current()) return;
        delete gtcProgress.saveIssues[entry.result.executionId];
        delete gtcOrders.resultIssues[entry.result.executionId];
        refreshRevision++;
      }
      catch (error) {
        if (!current()) return;
        await finishGtcResult(entry, true);
        gtcProgress.saveIssues[entry.result.executionId] = gtcSyncIssue(error);
        gtcOrders.resultIssues[entry.result.executionId] = gtcSyncIssue(error);
      }
    }
    // [changmen 扩展] 上传确认后读取公共订单，替换禁止改绑的 DisplayOnly 原单。
    // 读取失败单独重试，不把已确认结果放回上传队列，也不触发账号刷新或订单通知。
    if (current() && refreshedRevision < refreshRevision) {
      const revision = refreshRevision;
      try {
        const { useOrderStore } = await import("@/stores/orderStore");
        if (!current()) return;
        const store = useOrderStore(); const date = store.orderDate;
        const refreshed = await store.fetchOrders(date, { sideEffects: false,
          isCurrent: () => current() && store.orderDate === date });
        if (current() && refreshed) refreshedRevision = revision;
      }
      catch { /* 下轮只重试读取；后台已保存的订单结果不重复上传。 */ }
    }
  })().finally(() => { if (pending === task) pending = undefined; });
  pending = task; return task;
}
export function startGtcOrderSync(userId: string): void {
  if (owner === userId) return;
  stopGtcOrderSync(); owner = userId;
  const stamp = generation;
  stopProjection = registerOrderSyncProjection((account, orders) => {
    const session = getAuthSessionVersion();
    return synchronizeGtcCounterparts(account, orders, userId,
      () => generation === stamp && owner === userId && isAuthSessionCurrent(session));
  });
  void listLocalGtc(userId).then(rows => {
    if (generation === stamp && owner === userId) rows.forEach(rememberGtcOrderIdentity);
  }).catch(() => {});
  void listStoredGtcOrders(userId).then(rows => {
    if (generation !== stamp || owner !== userId) return;
    rows.forEach(row => rememberGtcOrderReference(row.id, row.owner, row.accountId, row.orderId, row.plan.orderHash));
    // 已在先前页面完成上传的原单，也须用公共财务行替换本地展示行。
    if (rows.some(row => Number(row.matched) > 0)) {
      refreshRevision++;
      void flushGtcResults().catch(() => {});
    }
  }).catch(() => {});
  const tick = () => {
    if (generation !== stamp) return;
    void flushGtcResults().catch(() => {});
    timer = setTimeout(tick, 5000);
  };
  stopListening = listenLocalGtcChanges();
  dispose = watch(() => localGtcChanges.revision, () => { void flushGtcResults().catch(() => {}); });
  tick();
}
export function stopGtcOrderSync(): void {
  generation++; owner = ""; clearTimeout(timer); timer = undefined; pending = undefined;
  refreshRevision = 0; refreshedRevision = 0;
  dispose?.(); dispose = undefined; stopListening?.(); stopListening = undefined;
  stopProjection?.(); stopProjection = undefined;
}
export function setupGtcOrderSynchronization(): void {
  const user = useUserStore(); const accounts = useAccountStore();
  watch(() => [user.isLoggedIn, user.userId, accounts.adminWorkspacePreview] as const, ([loggedIn, userId, preview]) => {
    if (loggedIn && userId && !preview) startGtcOrderSync(String(userId));
    else stopGtcOrderSync();
  }, { immediate: true });
  onScopeDispose(stopGtcOrderSync);
}
