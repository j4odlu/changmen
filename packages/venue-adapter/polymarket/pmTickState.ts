import { normalizePolymarketTickSize, type PolymarketTickSize } from "./pmTickPrice";

// [changmen 扩展] 只存控制事件，不把赔率流当作可执行订单簿。
const ticks = new Map<string, { tick: PolymarketTickSize; timestamp: number }>();
export function notePmTickFrame(raw: string): void {
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return; }
  for (const row of (Array.isArray(rows) ? rows : [rows])) {
    if (!row || row.event_type !== "tick_size_change" || !row.asset_id) continue;
    const timestamp = Number(row.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    try {
      const tick = normalizePolymarketTickSize(row.new_tick_size);
      const id = String(row.asset_id);
      if (timestamp >= (ticks.get(id)?.timestamp ?? 0)) ticks.set(id, { tick, timestamp });
    } catch { /* 未知控制值不能覆盖已知 tick。 */ }
  }
}
export function currentPmTick(tokenId: string, bookTimestamp = 0): PolymarketTickSize | undefined {
  const value = ticks.get(tokenId);
  return value && value.timestamp >= bookTimestamp ? value.tick : undefined;
}
export function clearPmTickStateForTests(): void { ticks.clear(); }
