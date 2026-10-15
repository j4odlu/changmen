import { normalizePolymarketTickSize, type PolymarketTickSize } from "../pmTickPrice";

// [changmen 扩展] 只存控制事件，不把赔率流当作可执行订单簿。
const ticks = new Map<string, { tick: PolymarketTickSize; timestamp: number }>();
const listeners = new Set<(tokenId: string, tick: PolymarketTickSize, timestamp: number) => void>();
const reconnectListeners = new Set<() => void>();
/** [changmen 扩展] 浏览器连接恢复或中继上游恢复后，补查可能漏掉的 tick。 */
export function onPmTickReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => { reconnectListeners.delete(listener); };
}
export function notePmTickReconnect(): void {
  for (const listener of reconnectListeners) { try { listener(); } catch { /* 不阻断行情 */ } }
}
/** [changmen 扩展] 新报价缓存订阅控制事件，原缓存读写语义保持不变。 */
export function onPmTickChange(listener: (tokenId: string, tick: PolymarketTickSize, timestamp: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notePmTickFrame(raw: string): void {
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return; }
  for (const row of (Array.isArray(rows) ? rows : [rows])) {
    if (row?.event_type === "changmen_tick_resync") { notePmTickReconnect(); continue; }
    if (!row || row.event_type !== "tick_size_change" || !row.asset_id) continue;
    const timestamp = Number(row.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    try {
      const tick = normalizePolymarketTickSize(row.new_tick_size);
      const id = String(row.asset_id);
      const previous = ticks.get(id);
      // [changmen 扩展] 两条 WS 可重复投递同一控制帧；不能回滚之后的 HTTP 确认值。
      if (timestamp === previous?.timestamp && tick === previous.tick) continue;
      if (timestamp >= (previous?.timestamp ?? 0)) {
        ticks.set(id, { tick, timestamp });
        for (const listener of listeners) { try { listener(id, tick, timestamp); } catch { /* 不影响原控制事件缓存 */ } }
      }
    } catch { /* 未知控制值不能覆盖已知 tick。 */ }
  }
}
export function currentPmTick(tokenId: string, bookTimestamp = 0): PolymarketTickSize | undefined {
  const value = ticks.get(tokenId);
  return value && value.timestamp >= bookTimestamp ? value.tick : undefined;
}
export function clearPmTickStateForTests(): void { ticks.clear(); }
