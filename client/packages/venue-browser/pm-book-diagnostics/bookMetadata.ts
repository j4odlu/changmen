import { BOOK_LIMITS, reduceBookFrame, type LocalOrderBook } from "@changmen/pm-market-data-browser/bookReducer";
import { polymarketMarketOrderOptions } from "../polymarket/pmMarketOrderOptions";

export interface BookMetadata { version: 2 | 3; tick: string; minSize: number; negRisk: boolean; market: string; at: number }
/** Previously completed, asset-bound HTTP preflight options only; never WS defaults. */
export function metadataFromHttpOptions(raw: unknown, asset: string, market: string, at: number): BookMetadata | undefined {
  const row = raw as { version?: number; tickSize?: string; minOrderSize?: number; negRisk?: boolean } | undefined;
  if (!row || ![2, 3].includes(row.version!) || !market || !Number.isFinite(at)) return;
  try {
    const options = polymarketMarketOrderOptions({ asset_id: asset, version: row.version === 3 ? "v2" : undefined,
      tick_size: row.tickSize, min_order_size: row.minOrderSize, neg_risk: row.negRisk }, asset);
    return { version: options.version, tick: options.tickSize, minSize: options.minOrderSize, negRisk: options.negRisk, market, at };
  } catch { return; }
}
export function parseHttpBook(raw: unknown, asset: string, now: number): { book: LocalOrderBook; metadata?: BookMetadata } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("http book");
  const row = raw as Record<string, unknown>;
  if (row.asset_id !== asset) throw new Error("http identity");
  const book = reduceBookFrame(new Map(), { ...row, event_type: "book" }, new Set([asset]), 0, now, Date.now()).books.get(asset)!;
  // Only a validated HTTP response may use the existing version convention (v2 => signing v3).
  // A WS book lacking version/constraints can never enter this metadata path.
  try {
    const market = polymarketMarketOrderOptions(row, asset);
    return { book, metadata: { version: market.version, tick: market.tickSize,
      minSize: market.minOrderSize, negRisk: market.negRisk, market: book.market, at: now } };
  } catch { return { book }; }
}
/** 仅公开直连、一个请求、可取消、有界响应；不使用会自动降级线路的公共 transport。 */
export async function fetchShadowHttpBook(asset: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(asset)}`, {
    signal, credentials: "omit", cache: "no-store", redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("shadow_http_failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BOOK_LIMITS.frameChars) throw new Error("shadow_http_limit");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
