export const TREND_WINDOW_MS = 30 * 60_000;
export const TREND_BUCKET_MS = 1_000;
export const TREND_GAP_MS = 30_000;

export interface PricePoint { at: number; price: number }
interface Bucket { first: PricePoint; low: PricePoint; high: PricePoint; last: PricePoint }

/** [changmen 扩展] 只读展示采样：每秒保留首、最低、最高和末价，内存不随 tick 数增长。 */
export class PriceHistory {
  private buckets: Bucket[] = [];

  push(price: number, at: number): void {
    if (!Number.isFinite(price) || price <= 0 || price >= 1 || !Number.isFinite(at) || at < 0)
      return;
    const last = this.buckets.at(-1);
    if (last && at < last.last.at)
      return;
    const point = { at, price };
    if (last && Math.floor(at / TREND_BUCKET_MS) === Math.floor(last.last.at / TREND_BUCKET_MS)) {
      if (price < last.low.price) last.low = point;
      if (price > last.high.price) last.high = point;
      last.last = point;
    }
    else {
      this.buckets.push({ first: point, low: point, high: point, last: point });
    }
    this.prune(at);
  }

  private prune(now: number): void {
    const cutoff = now - TREND_WINDOW_MS;
    while (this.buckets.length && this.buckets[0]!.last.at < cutoff)
      this.buckets.shift();
  }

  read(now: number): PricePoint[] {
    this.prune(now);
    const cutoff = now - TREND_WINDOW_MS;
    return this.buckets.flatMap(bucket => [...new Set([bucket.first, bucket.low, bucket.high, bucket.last])]
      .sort((a, b) => a.at - b.at)
      .filter(point => point.at >= cutoff)
      .map(point => ({ ...point })));
  }
}

/** 空白间隔不连线；使用阶梯线，避免把没有观察到的价格画成连续变化。 */
export function trendPath(points: readonly PricePoint[], now: number, plotHeight = 64): string {
  let prior: PricePoint | undefined;
  return points.map((point) => {
    const x = Math.max(0, Math.min(280, (point.at - (now - TREND_WINDOW_MS)) / TREND_WINDOW_MS * 280));
    const y = (1 - point.price) * plotHeight;
    const command = !prior || point.at - prior.at > TREND_GAP_MS
      ? `M${x.toFixed(2)},${y.toFixed(2)}`
      : `H${x.toFixed(2)}V${y.toFixed(2)}`;
    prior = point;
    return command;
  }).join(" ");
}
