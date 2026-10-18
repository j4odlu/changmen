/** [changmen 扩展] 只读展示独立查单；查到一次即停止，不消费业务上下文或发布事实快照。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { watchEffect } from "vue";
import { getProvider } from "@/runtime/venueAdapters";
import { useOrderStore } from "@/stores/orderStore";
import {
  observeRaySubmissionPreviews, pendingRaySubmissionPreviewAccounts, resetRaySubmissionPreviews,
  retireRaySubmissionPreviews, setRaySubmissionPreviewWake,
} from "./submissionPreview";

const RETRY_MS = 5000;
const polling = new Map<PlatformAccount, Promise<void>>();
let generation = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopWatching: (() => void) | undefined;

function retire(): void {
  retireRaySubmissionPreviews([...useOrderStore().orders.values()].flat());
}
function schedule(): void {
  if (!running || timer || !pendingRaySubmissionPreviewAccounts().some(account => !polling.has(account)))
    return;
  timer = setTimeout(() => { timer = undefined; poll(); }, RETRY_MS);
}
function poll(): void {
  if (!running)
    return;
  retire();
  for (const account of pendingRaySubmissionPreviewAccounts()) {
    if (polling.has(account))
      continue;
    const stamp = generation;
    const startedAt = Date.now();
    const task = Promise.resolve().then(async () => {
      if (!running || stamp !== generation)
        return;
      // 始终直读 adapter，不经过业务查单缓存；账号 active 和下注模式不决定展示用途。
      const orders = await getProvider(account)?.getOrders?.(account) ?? [];
      if (running && stamp === generation) {
        observeRaySubmissionPreviews(account, orders, startedAt);
        retire();
      }
    }).catch(() => { /* 展示查询失败只重试，不影响下注或业务状态。 */ }).finally(() => {
      if (polling.get(account) === task) {
        polling.delete(account);
        schedule();
      }
    });
    polling.set(account, task);
  }
}

export function startRaySubmissionPreviewPolling(): void {
  if (running)
    return;
  running = true;
  stopWatching = watchEffect(retire);
  setRaySubmissionPreviewWake(poll);
  poll();
}
export function stopRaySubmissionPreviewPolling(): void {
  running = false; generation++;
  clearTimeout(timer); timer = undefined;
  stopWatching?.(); stopWatching = undefined;
  polling.clear(); resetRaySubmissionPreviews();
}
