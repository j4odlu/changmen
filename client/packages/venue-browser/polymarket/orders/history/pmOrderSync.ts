/** Polymarket CLOB trades 增量 sync 窗口（changmen 扩展；合并仍靠 RDS stored） */

export const PM_ORDER_FULL_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/** 常规增量：距上次 sync 再往前重叠，至少 2h */
export const PM_INCREMENTAL_MIN_LOOKBACK_MS = 2 * 60 * 60 * 1000;
export const PM_INCREMENTAL_SYNC_OVERLAP_MS = 15 * 60 * 1000;
/** 有未结仓位时拉更长窗口，便于 CLOB/Gamma 捕获结算 */
export const PM_OPEN_POSITION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** 距上次全量超过此间隔则再拉 3 天 */
export const PM_FULL_RESYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface PolymarketOrderSyncState {
  lastSyncAtMs: number;
  lastFullSyncAtMs: number;
}

const syncByAccount = new Map<number, PolymarketOrderSyncState>();

export function resolvePolymarketTradeLookbackMs(
  accountId: number,
  hasOpenStored: boolean,
  now = Date.now(),
): number {
  const id = Number(accountId);
  if (!Number.isFinite(id) || id <= 0)
    return PM_ORDER_FULL_LOOKBACK_MS;

  const state = syncByAccount.get(id);
  if (!state || now - state.lastFullSyncAtMs >= PM_FULL_RESYNC_INTERVAL_MS)
    return PM_ORDER_FULL_LOOKBACK_MS;

  if (hasOpenStored)
    return Math.min(PM_ORDER_FULL_LOOKBACK_MS, PM_OPEN_POSITION_LOOKBACK_MS);

  const sinceLast = now - state.lastSyncAtMs + PM_INCREMENTAL_SYNC_OVERLAP_MS;
  return Math.min(
    PM_ORDER_FULL_LOOKBACK_MS,
    Math.max(PM_INCREMENTAL_MIN_LOOKBACK_MS, sinceLast),
  );
}

export function markPolymarketOrdersSynced(
  accountId: number,
  lookbackMs: number,
  now = Date.now(),
): void {
  const id = Number(accountId);
  if (!Number.isFinite(id) || id <= 0)
    return;
  const prev = syncByAccount.get(id);
  const isFull = lookbackMs >= PM_ORDER_FULL_LOOKBACK_MS
    || !prev
    || now - prev.lastFullSyncAtMs >= PM_FULL_RESYNC_INTERVAL_MS;
  syncByAccount.set(id, {
    lastSyncAtMs: now,
    lastFullSyncAtMs: isFull ? now : prev.lastFullSyncAtMs,
  });
}

/** 下注成功后下一帧 getOrders 至少覆盖 PM_INCREMENTAL_MIN 窗口 */
export function bumpPolymarketOrderSyncAfterBet(accountId: number, now = Date.now()): void {
  const id = Number(accountId);
  if (!Number.isFinite(id) || id <= 0)
    return;
  const prev = syncByAccount.get(id);
  syncByAccount.set(id, {
    lastSyncAtMs: now - PM_INCREMENTAL_MIN_LOOKBACK_MS,
    lastFullSyncAtMs: prev?.lastFullSyncAtMs ?? 0,
  });
}

export function resetPolymarketOrderSyncForTest(): void {
  syncByAccount.clear();
}

export function getPolymarketOrderSyncStateForTest(accountId: number) {
  return syncByAccount.get(Number(accountId));
}
