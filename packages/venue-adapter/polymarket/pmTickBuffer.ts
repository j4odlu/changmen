import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { isPolymarketPriceOnTick, normalizePolymarketTickSize, type PolymarketTickSize } from "./pmTickPrice";
import { onPmTickChange } from "./pmTickState";

/** [changmen 扩展] 仅供 +1 tick 报价；HTTP 初值不写入原下单控制事件缓存。 */
export interface PmTickBufferQuote {
  mode: "tick";
  tokenId: string;
  rawAsk: number;
  tick: PolymarketTickSize;
  cap: number;
  displayOdds: number;
}
type Book = { asset_id?: string; tick_size?: string | number; timestamp?: string | number };
export async function fetchPmTickBufferBook(tokenId: string): Promise<Book> {
  const { pmGetBook } = await import("./pmClientApi");
  return pmGetBook<Book>(tokenId);
}
type TickRow = { tick: PolymarketTickSize; timestamp: number; receivedAt: number; revision: number };
const ticks = new Map<string, TickRow>();
const listeners = new Set<(tokenId: string) => void>();
const pending = new Set<string>();
const retryAt = new Map<string, number>();
const queue: string[] = [];
let loader: ((tokenId: string) => Promise<Book>) | undefined;
let running = 0;
let generation = 0;
const MAX_AGE_MS = 60_000;

function publish(tokenId: string) {
  for (const listener of listeners) { try { listener(tokenId); } catch { /* 旁路通知不改变报价 */ } }
}
export function onPmTickBufferChange(listener: (tokenId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notePmTickBufferBook(tokenId: string, book: Book): void {
  if (String(book.asset_id ?? "") !== tokenId) throw new Error("PM tick 元数据资产不匹配");
  const tick = normalizePolymarketTickSize(book.tick_size);
  const timestamp = Number(book.timestamp) || 0;
  const previous = ticks.get(tokenId);
  if (previous && previous.timestamp > timestamp) return;
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1 });
  publish(tokenId);
}
onPmTickChange((tokenId, tick, timestamp) => {
  const previous = ticks.get(tokenId);
  if (previous && previous.timestamp > timestamp) return;
  ticks.set(tokenId, { tick, timestamp, receivedAt: Date.now(), revision: (previous?.revision ?? 0) + 1 });
  publish(tokenId);
});
export function pmTickBufferTick(tokenId: string): PolymarketTickSize | undefined {
  const row = ticks.get(tokenId);
  return row && Date.now() - row.receivedAt < MAX_AGE_MS ? row.tick : undefined;
}
export function setPmTickBufferLoader(value: typeof loader): void { loader = value; }
export function requestPmTickBufferTick(tokenId: string): void {
  if (!loader || !tokenId || pmTickBufferTick(tokenId) || pending.has(tokenId)
    || Date.now() < (retryAt.get(tokenId) ?? 0)) return;
  pending.add(tokenId);
  if (ticks.has(tokenId)) publish(tokenId);
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
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("PM tick 获取超时")), 10_000);
    });
    void Promise.race([Promise.resolve().then(() => load(tokenId)), deadline]).then(book => {
      if (epoch !== generation || revision !== (ticks.get(tokenId)?.revision ?? 0)) return;
      notePmTickBufferBook(tokenId, book);
    }).catch(() => {
      if (epoch === generation) retryAt.set(tokenId, Date.now() + 5_000);
    }).finally(() => {
      clearTimeout(timeout!);
      if (epoch !== generation) return;
      running--;
      pending.delete(tokenId);
      drain();
    });
  }
}
export function clearPmTickBufferMetadata(): void {
  generation++;
  ticks.clear(); pending.clear(); retryAt.clear(); queue.length = 0; running = 0;
}
export function createPmTickBufferQuote(tokenId: string, rawAsk: number, tick = pmTickBufferTick(tokenId)): PmTickBufferQuote | undefined {
  if (!tick || !isPolymarketPriceOnTick(rawAsk, tick)) return undefined;
  // 所有支持的 tick 均可精确表达为 1/10000；只增加一档。
  const cap = (Math.round(rawAsk * 10_000) + Math.round(Number(tick) * 10_000)) / 10_000;
  if (!isPolymarketPriceOnTick(cap, tick)) return undefined;
  const displayOdds = truncateOddsTo3(1 / cap);
  if (!(displayOdds > 1)) return undefined;
  return Object.freeze({ mode: "tick", tokenId, rawAsk, tick, cap, displayOdds });
}
export function validatePmTickBufferQuote(value: unknown, tokenId: string, odds: number): PmTickBufferQuote {
  const quote = value as PmTickBufferQuote | undefined;
  let expected: PmTickBufferQuote | undefined;
  try { if (quote) expected = createPmTickBufferQuote(tokenId, quote.rawAsk, normalizePolymarketTickSize(quote.tick)); } catch { /* 校验失败 */ }
  if (!quote || quote.mode !== "tick" || quote.tokenId !== tokenId || !expected
    || quote.cap !== expected.cap || quote.displayOdds !== expected.displayOdds || odds !== quote.displayOdds)
    throw new Error("PM +1 tick 报价缺失或不匹配，请新建投注尝试");
  return quote;
}
/** [changmen 扩展] 当前 CLOB SDK BUY 金额编码的份数；只用于 tick 模式最小份数预检。 */
export function pmTickBufferOrderShares(amount: number, quote: PmTickBufferQuote): number {
  const places = (n: number) => Number.isInteger(n) ? 0 : (String(n).split(".")[1]?.length ?? 0);
  const down = (n: number, d: number) => places(n) <= d ? n : Math.floor(n * 10 ** d) / 10 ** d;
  const up = (n: number, d: number) => places(n) <= d ? n : Math.ceil(n * 10 ** d) / 10 ** d;
  const decimals = (quote.tick.split(".")[1]?.length ?? 0) + 2;
  let shares = down(amount, 2) / quote.cap;
  if (places(shares) > decimals) {
    shares = up(shares, decimals + 4);
    if (places(shares) > decimals) shares = down(shares, decimals);
  }
  return shares;
}
