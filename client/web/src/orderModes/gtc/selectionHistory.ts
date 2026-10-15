import type { PlatformAccount } from "@/models/platformAccount";
import { captureGtcSession, refreshGtcRecords } from "./executionState";
import { localGtcChanges } from "./localStore";
import { startGtcRuntime } from "./runtime";
import { assertGtcHistoryAllowsLeg } from "./successMarkers";

interface HistoryRead {
  isCurrent: () => boolean;
  revision: number;
  pending: boolean;
  ready: boolean;
  retryAt: number;
  error: string;
}
const reads = new Map<string, HistoryRead>();

/** [changmen 扩展] 选号前后台恢复；未就绪则下一轮重新取价，不占用双腿预检窗口。 */
export function gtcSelectionHistoryStatus(owner: string, betId: number, accounts: readonly PlatformAccount[], noSameBet: boolean): string | undefined {
  const ids = [...new Set(accounts.filter(account => noSameBet || account.maxBetCount || account.lastOdds)
    .map(account => account.accountId))].sort((a, b) => a - b);
  if (!ids.length) return undefined;
  startGtcRuntime(owner);
  const key = JSON.stringify([owner, betId, ids]);
  const previous = reads.get(key);
  if (previous?.isCurrent()) {
    if (previous.pending) return "GTC 本盘口历史恢复中，等待重新选号";
    if (previous.ready && previous.revision === localGtcChanges.revision) return undefined;
    if (previous.retryAt > Date.now()) return previous.error;
  }
  const entry: HistoryRead = { isCurrent: captureGtcSession(), revision: localGtcChanges.revision,
    pending: true, ready: false, retryAt: 0, error: "" };
  reads.set(key, entry);
  // 有界缓存；淘汰只导致下次重新读取，不放行未恢复的历史。
  if (reads.size > 200) reads.delete(reads.keys().next().value!);
  void refreshGtcRecords(betId, ids).then(() => {
    if (entry.isCurrent()) entry.ready = true;
  }).catch((error) => {
    entry.error = error instanceof Error ? error.message : "GTC 本盘口历史恢复失败";
    entry.retryAt = Date.now() + 1000;
  }).finally(() => { entry.pending = false; });
  return "GTC 本盘口历史恢复中，等待重新选号";
}

export function gtcHistoryAllowsAccount(owner: string, account: PlatformAccount, betId: number, side: string, odds: number, noSameBet: boolean): boolean {
  try { assertGtcHistoryAllowsLeg(owner, account, betId, side, odds, noSameBet); return true; }
  catch { return false; }
}
