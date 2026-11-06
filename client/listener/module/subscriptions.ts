import { watch, type WatchStopHandle } from "vue";

export interface SubscriptionPorts<T, R> {
  key: (market: T) => string;
  signature: (market: T) => string;
  detect: (market: T) => R;
  result: (key: string, result: R) => void;
  size: (size: number) => void;
  wakeAt?: (market: T) => number | undefined;
}

/** [changmen 扩展] Per-market reactive dependencies, deduplicated bounded notification batches. */
export class MarketSubscriptions<T, R> {
  private stops: WatchStopHandle[] = [];
  private markets = new Map<string, T>();
  private pending = new Set<string>();
  private scheduled = false;
  private epoch = 0;
  private deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  constructor(private readonly ports: SubscriptionPorts<T, R>) {}

  replace(markets: readonly T[]): void {
    if (this.stopped) return;
    const next = new Map<string, T>();
    for (const market of markets) {
      const key = this.ports.key(market);
      if (next.has(key)) throw new Error(`重复监听盘口：${key}`);
      next.set(key, market);
    }
    this.clear();
    this.markets = next;
    for (const [key, market] of next)
      this.stops.push(watch(() => this.ports.signature(market), () => { this.invalidate(key); this.deadline(key, market); }, { immediate: true, flush: "sync" }));
    this.ports.size(next.size);
  }
  get(key: string): T | undefined { return this.markets.get(key); }
  invalidate(key: string): void {
    if (this.stopped || !this.markets.has(key)) return;
    this.pending.add(key);
    if (this.scheduled) return;
    this.scheduled = true;
    const epoch = this.epoch;
    queueMicrotask(() => this.flush(epoch));
  }
  private flush(epoch: number): void {
    if (epoch !== this.epoch || this.stopped) return;
    this.scheduled = false;
    for (const key of [...this.pending].slice(0, 50)) {
      this.pending.delete(key);
      const market = this.markets.get(key);
      if (market) this.ports.result(key, this.ports.detect(market));
    }
    if (this.pending.size) {
      this.scheduled = true;
      setTimeout(() => this.flush(epoch), 0);
    }
  }
  private clear(): void {
    this.epoch += 1;
    for (const stop of this.stops) stop();
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
    this.stops = []; this.pending.clear(); this.markets.clear(); this.scheduled = false;
  }
  private deadline(key: string, market: T): void {
    clearTimeout(this.deadlines.get(key)); this.deadlines.delete(key);
    const at = this.ports.wakeAt?.(market);
    if (at !== undefined && at > Date.now()) this.deadlines.set(key, setTimeout(() => {
      this.invalidate(key); this.deadline(key, market);
    }, Math.min(at - Date.now() + 1, 2_147_483_647)));
  }
  stop(): void { this.stopped = true; this.clear(); this.ports.size(0); }
}
