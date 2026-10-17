import { bookAgeFailure, withinAge, DYNAMIC_BOOK_AGES } from "./freshnessPolicy";
import { BOOK_LIMITS, numericAsks, type LocalOrderBook } from "../../../../realtime/orderBook/bookReducer";
import type { BookReader } from "../../../../realtime/orderBook/bookStore";
import { fetchShadowHttpBook, metadataFromHttpOptions, parseHttpBook, type BookMetadata } from "./bookMetadata";
import { registerWsBookShadowObserver, type ShadowAttempt } from "./shadowObserver";
import type { ShadowHttpSummary } from "./shadowWorkerProtocol";

export const SHADOW_KEY = "changmen:pm:ws-book-shadow";
export const officialGateway = (gateway: string): boolean => /^https:\/\/clob\.polymarket\.com\/?$/.test(gateway);
export interface ShadowSample {
  at: number; source: "probe" | "attempt"; tokenId: string; outcome: string; httpMs: number;
  localReadMs?: number; miss?: string; epoch?: number; revision?: number; ageMs?: number;
  sourceAt?: number; receivedWallAt?: number; depthAtHttpFillPrice?: number; httpFillPrice?: number;
  metadataVersion?: number; metadataTick?: string;
  httpFailed?: boolean; observerQueueMs?: number; beginQueueMs?: number; compareMs?: number; observerId?: number;
  linkId?: number; attemptId?: string; executionId?: string; leg?: string; role?: string;
  simulation?: import("./executionSimulation").ExecutionSimulation;
  simulationComparison?: string;
  comparisonEvidence?: "timestamp_and_observed_depth";
  simulationMs?: number;
  fallbackResult?: "existing_http_success" | "existing_http_failure";
}
const equalAsks = (a: Array<{ price: number; size: number }>, b: Array<{ price: number; size: number }>) =>
  a.length === b.length && a.every((row, i) => row.price === b[i]?.price && row.size === b[i]?.size);
export function compareAsks(history: readonly LocalOrderBook[], sourceAt: number, asks: Array<{ price: number; size: number }>): string {
  const aligned = history.filter(book => book.sourceAt === sourceAt);
  if (!aligned.length) return history.length ? "unaligned_or_changed" : "no_snapshot";
  const states = aligned.map(numericAsks);
  // Timestamp has millisecond precision, not sequence semantics; different states may share it.
  if (states.some(state => !equalAsks(state, states[0]!))) return "ambiguous_timestamp";
  return equalAsks(states[0]!, asks) ? "aligned_equal" : "aligned_difference";
}
/** 动态消费者：HTTP 元数据与旁路比较，不拥有簿生命周期或实际执行权限。 */
export class WsBookShadowRuntime {
  private metadata = new Map<string, BookMetadata>();
  private samples: ShadowSample[] = [];
  private counters: Record<string, number> = {};
  private generation = 0;
  private metadataBarrierAt = performance.now();
  private assetScopes = new Map<string, { version: number; barrier: number }>();
  private scopeSerial = 0;
  private requestAsset?: string;
  private ids: string[] = [];
  private cursor = 0;
  private pendingAttempts = 0;
  private stopped = false;
  private request?: AbortController;
  private probeTimeout?: ReturnType<typeof setTimeout>;
  private probeTimer: ReturnType<typeof setInterval>;
  private unobserve: () => void;
  private unbook: () => void;
  constructor(private allowed: () => boolean, private books: BookReader, private options: {
    fetchBook?: typeof fetchShadowHttpBook;
    onMetadata?: () => void;
  } = {}) {
    this.unbook = books.onInvalidate(({ reason, assets }) => {
      if (!assets) { ++this.generation; this.metadataBarrierAt = performance.now(); }
      for (const asset of assets ?? this.ids) if (this.ids.includes(asset))
        this.assetScopes.set(asset, { version: ++this.scopeSerial, barrier: performance.now() });
      if (!assets || (this.requestAsset && assets.includes(this.requestAsset))) this.request?.abort();
      if (assets) for (const asset of assets) this.metadata.delete(asset); else this.metadata.clear();
      if ((!assets || (this.requestAsset && assets.includes(this.requestAsset))) && this.probeTimeout) clearTimeout(this.probeTimeout);
      this.count(reason);
      this.options.onMetadata?.();
    });
    this.unobserve = registerWsBookShadowObserver(attempt => this.begin(attempt));
    this.probeTimer = setInterval(() => { void this.probe(options.fetchBook ?? fetchShadowHttpBook); }, 3_000);
  }
  private count(reason: string): void { this.counters[reason] = (this.counters[reason] ?? 0) + 1; }
  private record(sample: ShadowSample): void {
    if (sample.outcome !== "attempt_capacity") this.count(sample.outcome); // capacity counted on admission
    this.samples.push(sample);
    if (this.samples.length > 256) this.samples.shift();
  }
  setAssets(ids: readonly string[]): void {
    const next = [...new Set(ids)].filter(id => /^\d+$/.test(id)).slice(0, BOOK_LIMITS.assets).sort();
    if (this.stopped) return;
    if (next.join(",") !== this.ids.join(",")) {
      if (this.requestAsset && !next.includes(this.requestAsset)) this.request?.abort();
      for (const asset of this.metadata.keys()) if (!next.includes(asset)) this.metadata.delete(asset);
      for (const asset of this.assetScopes.keys()) if (!next.includes(asset)) this.assetScopes.delete(asset);
      for (const asset of next) if (!this.assetScopes.has(asset))
        this.assetScopes.set(asset, { version: ++this.scopeSerial, barrier: performance.now() });
      this.options.onMetadata?.();
    }
    this.ids = next;
  }
  private remember(asset: string, metadata: BookMetadata): void {
    // Concurrent HTTP completions must not replace a newer observation with an older one.
    if ((this.metadata.get(asset)?.at ?? -Infinity) > metadata.at) return;
    this.metadata.set(asset, metadata); this.options.onMetadata?.();
  }
  reconcile(): void { this.setAssets(this.ids); }
  private miss(book: LocalOrderBook | undefined, asset: string, now: number): string | undefined {
    if (!book) return "no_snapshot";
    const ageFailure = bookAgeFailure({ receivedClockAt: book.receivedAt, snapshotClockAt: book.snapshotAt, sourceAt: book.sourceAt }, now, Date.now());
    if (ageFailure) return ageFailure;
    if (book.snapshotEvidence !== true) return "snapshot_evidence_missing";
    const meta = this.metadata.get(asset);
    if (!meta || meta.market !== book.market || !withinAge(meta.at, now, DYNAMIC_BOOK_AGES.metadata)) return "metadata_unknown_or_stale";
    return undefined;
  }
  private begin(attempt: Readonly<ShadowAttempt>) {
    if (this.stopped || !this.allowed() || attempt.proxied || !officialGateway(attempt.gateway)) return;
    this.count("attempt_seen");
    const capacity = this.pendingAttempts >= 32;
    if (capacity) this.count("attempt_capacity"); else ++this.pendingAttempts;
    const started = performance.now(), generation = this.generation, bookGeneration = this.books.generation;
    const assetScope = this.assetScopes.get(attempt.tokenId)?.version;
    const before = capacity ? [] : [...this.books.history(attempt.tokenId)], book = before.at(-1);
    const metadata = this.metadata.get(attempt.tokenId);
    const miss = attempt.tick ? "tick_quote_excluded" : this.miss(book, attempt.tokenId, started);
    const localReadMs = performance.now() - started;
    // Freeze only primitives and own immutable books. Never retain account credentials/options.
    let finished = false;
    return (raw: unknown, failed: boolean) => {
      if (finished) return;
      finished = true; if (!capacity) --this.pendingAttempts;
      const completed = performance.now(), httpMs = completed - started;
      const invalid = this.stopped ? "scope_stopped" : !this.allowed() || generation !== this.generation || assetScope !== this.assetScopes.get(attempt.tokenId)?.version ? "epoch_or_route_changed" : undefined;
      if (invalid) this.count("attempt_discarded_epoch_or_route");
      const http = raw as ShadowHttpSummary | undefined;
      const asks = http?.orderOptions?.asks;
      const rows = [...before, ...this.books.history(attempt.tokenId)];
      const outcome = invalid ?? (capacity ? "attempt_capacity" : failed ? "http_market_rejected" : asks ? compareAsks(rows, Number(http?.orderOptions?.bookTimestamp), asks) : "http_shape_unknown");
      const httpFillPrice = http?.price;
      this.record({ at: Date.now(), source: "attempt", ...attempt, simulation: undefined, outcome, comparisonEvidence: "timestamp_and_observed_depth", miss, localReadMs,
        httpMs, httpFailed: failed, epoch: book?.epoch, revision: book?.revision,
        ageMs: book ? started - book.receivedAt : undefined, sourceAt: book?.sourceAt, receivedWallAt: book?.receivedWallAt,
        metadataVersion: metadata?.version, metadataTick: metadata?.tick, httpFillPrice,
        depthAtHttpFillPrice: !invalid && !capacity && book && httpFillPrice ? numericAsks(book).filter(row => row.price <= httpFillPrice).reduce((sum, row) => sum + row.price * row.size, 0) : undefined,
        compareMs: performance.now() - completed });
      if (outcome === "aligned_difference" && !this.stopped && this.allowed()) this.books.reportIntegrity({ generation: bookGeneration, asset: attempt.tokenId, sourceAt: Number(http?.orderOptions?.bookTimestamp), asks: asks!, before: before.length ? before : this.books.history(attempt.tokenId) });
      // Reuse only earlier completed HTTP work for FUTURE attempts. Freeze the original
      // HTTP start time, require the same asset/market generation, and never seed WS depth.
      const metaAt = Number(http?.metadataClockAt) - performance.timeOrigin;
      const current = this.books.history(attempt.tokenId).at(-1);
      if (!invalid && !capacity && !failed && !attempt.tick && book && current?.market === book.market
        && bookGeneration === this.books.generation && this.ids.includes(attempt.tokenId)
        && Number.isFinite(metaAt) && metaAt >= Math.max(this.metadataBarrierAt, this.assetScopes.get(attempt.tokenId)?.barrier ?? Infinity) && metaAt <= started && completed - metaAt <= DYNAMIC_BOOK_AGES.metadata) {
        const next = metadataFromHttpOptions(http?.orderOptions, attempt.tokenId, book.market, metaAt);
        if (next) { this.remember(attempt.tokenId, next); this.count("metadata_reused_http"); }
      }
    };
  }
  private async probe(fetchBook: typeof fetchShadowHttpBook): Promise<void> {
    if (this.stopped || !this.allowed() || this.request || !this.ids.length) return;
    const rotated = this.ids.map((_, i) => this.ids[(this.cursor + i) % this.ids.length]!);
    const now = performance.now();
    const asset = rotated.find(id => !this.metadata.has(id) || now - this.metadata.get(id)!.at > DYNAMIC_BOOK_AGES.metadata)
      ?? rotated.reduce((oldest, id) => this.metadata.get(id)!.at < this.metadata.get(oldest)!.at ? id : oldest);
    this.cursor = (this.ids.indexOf(asset) + 1) % this.ids.length;
    const generation = this.generation, bookGeneration = this.books.generation, started = performance.now(), before = [...this.books.history(asset)];
    const assetScope = this.assetScopes.get(asset)?.version;
    const controller = new AbortController(); this.request = controller; this.requestAsset = asset;
    const timeout = setTimeout(() => controller.abort(), 5_000);
    this.probeTimeout = timeout;
    try {
      const raw = await fetchBook(asset, controller.signal);
      if (controller.signal.aborted || this.stopped || !this.allowed() || generation !== this.generation
        || assetScope !== this.assetScopes.get(asset)?.version) return;
      const { book, metadata } = parseHttpBook(raw, asset, started);
      if (metadata) this.remember(asset, metadata);
      else if ((this.metadata.get(asset)?.at ?? -Infinity) <= started) { this.metadata.delete(asset); this.options.onMetadata?.(); }
      const rows = [...before, ...this.books.history(asset)];
      let outcome = compareAsks(rows, book.sourceAt, numericAsks(book));
      if (rows.some(row => row.market !== book.market)) outcome = "aligned_difference";
      // Compare full bids too; timestamps/hash strings are not exchange sequence proofs.
      if (outcome === "aligned_equal") {
        const aligned = rows.filter(row => row.sourceAt === book.sourceAt);
        const bids = (row: LocalOrderBook) => JSON.stringify([...row.bids].sort());
        if (aligned.some(row => bids(row) !== bids(aligned[0]!))) outcome = "ambiguous_timestamp";
        else if (bids(aligned[0]!) !== bids(book)) outcome = "aligned_difference";
      }
      this.record({ at: Date.now(), source: "probe", tokenId: asset, outcome, comparisonEvidence: "timestamp_and_observed_depth", httpMs: performance.now() - started });
      // A comparable discrepancy cannot remain a trusted shadow candidate.
      if (outcome === "aligned_difference") this.books.reportIntegrity({ generation: bookGeneration, asset, sourceAt: book.sourceAt, asks: numericAsks(book), book, before: before.length ? before : this.books.history(asset) });
    } catch {
      if (!this.stopped && generation === this.generation) this.count("probe_failed");
    } finally {
      clearTimeout(timeout); if (this.probeTimeout === timeout) this.probeTimeout = undefined;
      if (this.request === controller) { this.request = undefined; this.requestAsset = undefined; }
    }
  }
  executionMetadata() {
    return [...this.metadata].map(([asset, meta]) => ({ ...meta, asset, bookGeneration: this.books.generation,
      assetGeneration: this.books.assetGeneration(asset), clockAt: performance.timeOrigin + meta.at }));
  }
  report() {
    const now = performance.now(), misses: Record<string, number> = {};
    let eligible = 0, snapshotFresh = 0;
    for (const id of this.ids) {
      const book = this.books.history(id).at(-1);
      if (book && withinAge(book.snapshotAt, now, DYNAMIC_BOOK_AGES.snapshot)) snapshotFresh++;
      const reason = this.miss(book, id, now);
      if (reason) misses[reason] = (misses[reason] ?? 0) + 1; else eligible++;
    }
    const durations = (field: "httpMs" | "localReadMs", role = "execute") => {
      const values = this.samples.filter(s => s.source === "attempt" && s.role === role).map(s => s[field]).filter((n): n is number => n != null).sort((a, b) => a - b);
      return { count: values.length, p50: values.length ? values[Math.ceil(values.length * .5) - 1] : null,
        p95: values.length ? values[Math.ceil(values.length * .95) - 1] : null };
    };
    return { mode: "shadow", executionSource: "existing-http", activeSupported: false, assets: this.ids.length,
      executionMetadata: this.executionMetadata(),
      routes: { marketWs: "official", http: "direct", submit: "direct" }, pendingAttempts: this.pendingAttempts,
      snapshotsInMemory: this.ids.filter(id => this.books.history(id).length).length, metadataInMemory: this.metadata.size,
      coverage: { at: Date.now(), assets: this.ids.length, snapshotFresh, eligible, misses },
      counters: { ...this.books.statistics(), ...this.counters }, httpMarketMs: durations("httpMs"), localReadMs: durations("localReadMs"),
      precheckOnlyHttpMs: durations("httpMs", "precheckOnly"),
      samples: this.samples.map(row => ({ ...row })), limits: { ...BOOK_LIMITS },
      note: "Shadow timings are diagnostic only; localReadMs excludes full executable-price validation. No fill-rate evidence." };
  }
  stop(): void {
    this.stopped = true; clearInterval(this.probeTimer); this.unobserve(); this.request?.abort(); this.unbook();
    if (this.probeTimeout) clearTimeout(this.probeTimeout); this.metadata.clear();
    // Detached diagnostics may finish after teardown, but can never restart sockets or become the next user's report.
    this.ids = []; this.assetScopes.clear();
  }
}
