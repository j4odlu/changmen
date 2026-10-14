import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcTradeHistory } from "@changmen/venue-adapter/polymarket/gtc";
import type { PlatformAccount } from "@/models/platformAccount";
/** [changmen 扩展] PM GTC 原单独立恢复、HTTP 核对和 WS 监听，终态完成核对后停止。 */
import { captureGtcSession, currentGtc, gtcInitialDispatches, gtcProgress, markGtcLegOnce, mutateGtc } from "@/orderModes/gtc/executionState";
import { gtcPmReconciled } from "@/orderModes/gtc/pollingPolicy";
import { useAccountStore } from "@/stores/accountStore";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { createGtcPmOrderPolling } from "./pmPolling";
import { recoverMonitorRecords } from "./recovery";

async function read(account: PlatformAccount, row: GtcExecution, shared?: () => Promise<GtcTradeHistory>) {
  const api = await import("@changmen/venue-adapter/polymarket/gtc");
  // [changmen 扩展] 原单→成交历史的核对顺序保持；核对不参与首次第二腿发送裁决。
  if (shared && row.decision === "closed")
    return api.readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt, shared());
  return api.readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt);
}

const polling = createGtcPmOrderPolling({ current: currentGtc, mutate: mutateGtc, mark: markGtcLegOnce, captureCurrent: captureGtcSession, read });
export const pollGtc = polling.poll;
export const cancelGtc = polling.cancel;
const loop = createOrderMonitorLoop({
  recover: recoverMonitorRecords,
  active: () => !gtcProgress.ready || gtcProgress.records.some(row => !gtcPmReconciled(row) || Boolean(gtcProgress.queryIssues[row.id])),
  tick() {
    const isCurrent = captureGtcSession();
    const batches = new Map<number, Promise<GtcTradeHistory>>();
    for (const row of [...gtcProgress.records]) {
      if (gtcInitialDispatches.has(row.id)) continue;
      if (!gtcPmReconciled(row) || gtcProgress.queryIssues[row.id]) {
        void polling.poll(row.id, () => {
          let batch = batches.get(row.plan.playerId);
          if (!batch) {
            const since = Math.min(...gtcProgress.records.filter(r => r.plan.playerId === row.plan.playerId && (!gtcPmReconciled(r) || gtcProgress.queryIssues[r.id])).map(r => r.createdAt));
            batch = import("@changmen/venue-adapter/polymarket/gtc").then((api) => {
              const account = useAccountStore().findAccount(row.plan.playerId);
              if (!isCurrent() || !account)
                throw new Error("GTC 会话或原 PM 账号已变更");
              return api.readGtcTradeHistory(account, since);
            });
            void batch.catch(() => {}); batches.set(row.plan.playerId, batch);
          }
          return batch;
        }).catch(() => {});
      }
      else {
        delete gtcProgress.queryIssues[row.id];
      }
      void polling.watch(row.id).catch(() => {});
    }
  },
});
export const startPmGtcMonitoring = loop.start;
export function stopPmGtcMonitoring(): void { loop.stop(); polling.reset(); }
