import { currentPmTick, onPmTickChange, onPmTickReconnect } from "../pmTickState";
import { normalizePolymarketTickSize, type PolymarketTickSize } from "../pmTickPrice";

/** [changmen 扩展] 元数据生命周期独立于价格转换及原始行情接收。 */
export type PmTickBook = { asset_id?: string; tick_size?: string | number; timestamp?: string | number };
export type PmTickSizeResponse = { minimum_tick_size: string | number };
type TickRow = { tick: PolymarketTickSize; timestamp: number; receivedAt: number; revision: number; connection: number };
const ticks = new Map<string, TickRow>();
const listeners = new Set<(tokenId: string) => void>();
const pending = new Set<string>();
const retryAt = new Map<string, number>();
const queue: string[] = [];
let activeTokenIds = new Set<string>();
const forced = new Set<string>();
let reconnectRevision = 0;
let loader: ((tokenId: string) => Promise<PmTickSizeResponse>) | undefined;
let running = 0;
let generation = 0;
const REFRESH_MS = 10 * 60_000;

export async function fetchPmTickBufferTickSize(tokenId: string): Promise<PmTickSizeResponse> {
  const { pmTransportHttpGet } = await import("../pmTransport");
  const { POLYMARKET_CLOB_API } = await import("../api");
  const id = String(tokenId).trim();
  if (!id) throw new Error("tokenId 必填");
  const params = new URLSearchParams({ token_id: id });
  return pmTransportHttpGet<PmTickSizeResponse>(`${POLYMARKET_CLOB_API}/tick-size?${params.toString()}`);
}
function publish(tokenId: string) {
  for (const listener of listeners) { try { listener(tokenId); } catch { /* 旁路通知 */ } }
}
export function onPmTickBufferChange(listener: (tokenId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notePmTickBufferBook(tokenId: string, book: PmTickBook): void {
  if (String(book.asset_id ?? "") !== tokenId) throw new Error("PM tick 元数据资产不匹配");
  const timestamp = Number(book.timestamp) || 0;
  // 报价缓存被清空后，仍不能越过已经收到的较新 WS 控制事件。
  const tick = currentPmTick(tokenId, timestamp) ?? normalizePolymarketTickSize(book.tick_size);
  const previous = ticks.get(tokenId);
  if (previous && previous.timestamp > timestamp) return;
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1, connection: reconnectRevision });
  if (previous?.tick !== tick) publish(tokenId);
}
onPmTickChange((tokenId, tick, timestamp) => {
  const previous = ticks.get(tokenId);
  if (previous && previous.timestamp > timestamp) return;
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1, connection: reconnectRevision });
  if (previous?.tick !== tick) publish(tokenId);
});
/** 已确认的 tick 持续可读；刷新失败不把正常行情变成锁盘。下单另拉簿验证。 */
export function pmTickBufferTick(tokenId: string): PolymarketTickSize | undefined {
  const row = ticks.get(tokenId);
  // [changmen 扩展] HTTP 刷新可新于已缓存的 WS；后续 WS 由监听器更新本行。
  return row?.tick ?? currentPmTick(tokenId);
}
export function setPmTickBufferLoader(value: typeof loader): void { loader = value; }
/** 停止/收缩预取只丢弃排队任务，在途请求继续占用真实并发槽。 */
export function retainPmTickBufferRequests(tokenIds: ReadonlySet<string>): void {
  activeTokenIds = new Set(tokenIds);
  for (const id of forced) if (!tokenIds.has(id)) forced.delete(id);
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!tokenIds.has(queue[i]!)) pending.delete(queue.splice(i, 1)[0]!);
  }
}
onPmTickReconnect(() => {
  // [changmen 扩展] 即使功能关闭，也记录连接代际；再次启用时不能复用断线前的缓存。
  reconnectRevision++;
  if (!loader) return;
  for (const id of activeTokenIds) {
    forced.add(id);
    retryAt.delete(id);
    requestPmTickBufferTick(id);
  }
});
export function requestPmTickBufferTick(tokenId: string): void {
  if (!loader || !tokenId) return;
  // [changmen 扩展] 行情首次到达可早于下一轮 prefetch；立即登记，避免重连漏补查。
  activeTokenIds.add(tokenId);
  const row = ticks.get(tokenId);
  if ((!forced.has(tokenId) && row && row.connection === reconnectRevision && Date.now() - row.receivedAt < REFRESH_MS)
    || pending.has(tokenId) || Date.now() < (retryAt.get(tokenId) ?? 0)) return;
  pending.add(tokenId);
  queue.push(tokenId);
  drain();
}
function drain(): void {
  while (loader && running < 4 && queue.length) {
    const tokenId = queue.shift()!;
    const load = loader;
    const revision = ticks.get(tokenId)?.revision ?? 0;
    const epoch = generation;
    const connection = reconnectRevision;
    const wasForced = forced.delete(tokenId);
    running++;
    // 不用 Promise.race 假装请求已结束；底层 HTTP 自带超时，真实完成才释放槽。
    void Promise.resolve().then(() => load(tokenId)).then(result => {
      // [changmen 扩展] /tick-size 无时间戳：请求期间发生 WS/预检更新或清空时丢弃响应。
      if (epoch !== generation || connection !== reconnectRevision || revision !== (ticks.get(tokenId)?.revision ?? 0)) return;
      const tick = normalizePolymarketTickSize(result.minimum_tick_size);
      const previous = ticks.get(tokenId);
      ticks.set(tokenId, { tick, timestamp: previous?.timestamp ?? 0,
        receivedAt: Date.now(), revision: revision + 1, connection });
      if (previous?.tick !== tick) publish(tokenId);
      retryAt.delete(tokenId);
    }).catch(err => {
      if (epoch !== generation || connection !== reconnectRevision || revision !== (ticks.get(tokenId)?.revision ?? 0)) return;
      // [changmen 扩展] 重连补查失败后仍须重试，不能被尚未到期的旧缓存挡住。
      if (wasForced && activeTokenIds.has(tokenId)) forced.add(tokenId);
      retryAt.set(tokenId, Date.now() + 5_000);
      console.warn("[PM quote] tick 元数据查询失败，保留已确认值", tokenId, err instanceof Error ? err.message : String(err));
    }).finally(() => {
      running--;
      pending.delete(tokenId);
      if (forced.has(tokenId) && activeTokenIds.has(tokenId)) requestPmTickBufferTick(tokenId);
      drain();
    });
  }
}
export function clearPmTickBufferMetadata(): void {
  generation++;
  ticks.clear(); retryAt.clear();
  retainPmTickBufferRequests(new Set());
  // 不重置 running / 在途 pending，否则切换或重装会突破并发限制。
}
