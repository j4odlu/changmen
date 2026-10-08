import { currentPmTick, onPmTickChange } from "./pmTickState";
import { normalizePolymarketTickSize, type PolymarketTickSize } from "./pmTickPrice";

/** [changmen 扩展] 元数据生命周期独立于价格转换及原始行情接收。 */
export type PmTickBook = { asset_id?: string; tick_size?: string | number; timestamp?: string | number };
type TickRow = { tick: PolymarketTickSize; timestamp: number; receivedAt: number; revision: number };
const ticks = new Map<string, TickRow>();
const listeners = new Set<(tokenId: string) => void>();
const pending = new Set<string>();
const retryAt = new Map<string, number>();
const queue: string[] = [];
let loader: ((tokenId: string) => Promise<PmTickBook>) | undefined;
let running = 0;
let generation = 0;
const REFRESH_MS = 60_000;

export async function fetchPmTickBufferBook(tokenId: string): Promise<PmTickBook> {
  const { pmGetBook } = await import("./pmClientApi");
  return pmGetBook<PmTickBook>(tokenId);
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
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1 });
  if (previous?.tick !== tick) publish(tokenId);
}
onPmTickChange((tokenId, tick, timestamp) => {
  const previous = ticks.get(tokenId);
  if (previous && previous.timestamp > timestamp) return;
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1 });
  if (previous?.tick !== tick) publish(tokenId);
});
/** 已确认的 tick 持续可读；刷新失败不把正常行情变成锁盘。下单另拉簿验证。 */
export function pmTickBufferTick(tokenId: string): PolymarketTickSize | undefined {
  const row = ticks.get(tokenId);
  return currentPmTick(tokenId, row?.timestamp ?? 0) ?? row?.tick;
}
export function setPmTickBufferLoader(value: typeof loader): void { loader = value; }
/** 停止/收缩预取只丢弃排队任务，在途请求继续占用真实并发槽。 */
export function retainPmTickBufferRequests(tokenIds: ReadonlySet<string>): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!tokenIds.has(queue[i]!)) pending.delete(queue.splice(i, 1)[0]!);
  }
}
export function requestPmTickBufferTick(tokenId: string): void {
  const row = ticks.get(tokenId);
  if (!loader || !tokenId || (row && Date.now() - row.receivedAt < REFRESH_MS)
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
    running++;
    // 不用 Promise.race 假装请求已结束；底层 HTTP 自带超时，真实完成才释放槽。
    void Promise.resolve().then(() => load(tokenId)).then(book => {
      if (epoch !== generation || revision !== (ticks.get(tokenId)?.revision ?? 0)) return;
      notePmTickBufferBook(tokenId, book);
      retryAt.delete(tokenId);
    }).catch(err => {
      if (epoch !== generation) return;
      retryAt.set(tokenId, Date.now() + 5_000);
      console.warn("[PM quote] tick 元数据查询失败，保留已确认值", tokenId, err instanceof Error ? err.message : String(err));
    }).finally(() => {
      running--;
      pending.delete(tokenId);
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
