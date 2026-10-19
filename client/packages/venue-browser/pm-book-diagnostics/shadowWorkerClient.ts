import { BOOK_LIMITS } from "@changmen/pm-market-data-browser/bookReducer";
import { MAILBOX_LIMITS } from "@changmen/pm-market-data-browser/orderedWorkerMailbox";
import type { BookConsumerPort, BookLease, DiagnosticChannel } from "@changmen/pm-market-data-browser/service";
import { officialGateway, type ShadowSample, type WsBookShadowRuntime } from "./bookRuntime";
import { registerWsBookShadowObserver, type ShadowAttempt } from "./shadowObserver";
import { observerClock, type ShadowHttpSummary, type ShadowWorkerRequest, type ShadowWorkerResponse } from "./shadowWorkerProtocol";
import { copySimulationInput, simulateLocalSource, type SimulationObservation } from "./executionSimulation";
import { simulateExecutableBuy } from "./executionMath";
import type { PolymarketOrderOptions } from "../../../../packages/venue-adapter/polymarket/fok/preflight";

/** Main-thread dynamic consumer. The injected service owns all shared market resources. */
export class WsBookShadowWorkerClient {
  private stopped = false;
  private lease?: BookLease;
  private channel?: DiagnosticChannel;
  private requestedIds: string[] = [];
  private coveredIds: string[] = [];
  private consumerGeneration = -1;
  private consumerFailure?: string;
  private simulationFailures = new Map<string, string>();
  private executionMetadata: ReturnType<WsBookShadowRuntime["executionMetadata"]> = [];
  private metadataRevision = -1;
  private get failure() { return this.service.report().failure ?? this.consumerFailure; }
  private get streamGeneration() { return this.service.report().generation; }
  private serial = 0;
  private pending = new Map<number, { at: number; generation: number; sample?: ShadowSample }>();
  private samples: ShadowSample[] = [];
  private counters: Record<string, number> = {};
  private latest?: Omit<ReturnType<WsBookShadowRuntime["report"]>, "executionMetadata">;
  private unobserve: () => void;
  private timer: ReturnType<typeof setInterval>;
  constructor(private allowed: () => boolean, private service: BookConsumerPort) {
    try {
      this.lease = service.acquire();
      this.channel = service.attachDiagnostics(payload => this.receive(payload as ShadowWorkerResponse));
    } catch { this.lease?.release(); this.lease = undefined; this.consumerFailure = "consumer_unavailable"; }
    // A refused second diagnostic client must not steal the admitted client's observation slot.
    this.unobserve = !this.channel && service.report().diagnostics > 0 ? () => {}
      : registerWsBookShadowObserver(attempt => this.begin(attempt));
    this.timer = setInterval(() => this.reconcile(), 1_000);
  }
  private count(key: string): void { this.counters[key] = (this.counters[key] ?? 0) + 1; }
  private send(message: ShadowWorkerRequest): boolean {
    if (this.stopped || !this.channel) return false;
    return this.channel.send(message, message.type === "finish" ? 512 + (message.raw?.orderOptions?.asks.length ?? 0) * 128 : 8192);
  }
  private receive(message: ShadowWorkerResponse): void {
    if (this.stopped || !this.service.report().worker) return; // Queued callbacks cannot republish old books.
    if (message.type === "batch_ack") return;
    if (message.type === "stream_ack") return;
    if (!this.allowed()) { this.stop(); return; }
    if (message.type === "metadata") {
      if (message.generation === this.streamGeneration && message.revision > this.metadataRevision) {
        this.metadataRevision = message.revision; this.executionMetadata = message.entries.map(row => ({ ...row }));
      }
      return;
    }
    if (message.type === "report") {
      if (message.generation === this.streamGeneration) this.latest = message.report;
    }
    else {
      const entry = this.pending.get(message.id); this.pending.delete(message.id);
      if (!entry?.sample) return;
      if (entry.generation !== this.streamGeneration) { entry.sample.outcome = "epoch_or_route_changed"; return; }
      // HTTP timing/result/identity always originate at the actual main-thread HTTP hook.
      const { outcome, miss, epoch, revision, ageMs, sourceAt, receivedWallAt, metadataVersion, metadataTick,
        depthAtHttpFillPrice, localReadMs, compareMs, observerQueueMs, beginQueueMs, comparisonEvidence } = message.sample;
      Object.assign(entry.sample, { outcome, miss, epoch, revision, ageMs, sourceAt, receivedWallAt,
        metadataVersion, metadataTick, depthAtHttpFillPrice, localReadMs, compareMs, observerQueueMs, beginQueueMs, comparisonEvidence });
      if (entry.sample.simulationComparison === "aligned_equal" && outcome !== "aligned_equal")
        entry.sample.simulationComparison = outcome;
    }
  }
  setAssets(ids: readonly string[]): void {
    if (this.stopped || !this.allowed()) return;
    const next = [...new Set(ids)].filter(id => /^\d{1,256}$/.test(id)).slice(0, BOOK_LIMITS.assets).sort();
    for (const asset of this.simulationFailures.keys()) if (!next.includes(asset)) this.simulationFailures.delete(asset);
    this.requestedIds = next; this.lease?.setInterests(next);
    this.syncConsumerAssets();
  }
  private syncConsumerAssets(): void {
    const state = this.service.report(), ids = this.requestedIds.filter(id => state.ids.includes(id));
    if (ids.join(",") === this.coveredIds.join(",") && this.consumerGeneration === state.generation) return;
    this.executionMetadata = this.consumerGeneration === state.generation
      ? this.executionMetadata.filter(row => ids.includes(row.asset)) : [];
    this.coveredIds = ids; this.consumerGeneration = state.generation; this.latest = undefined;
    this.send({ type: "assets", ids, generation: state.generation });
  }
  reconcile(): boolean {
    if (this.stopped) return false;
    if (!this.allowed()) { this.stop(); return false; }
    this.syncConsumerAssets();

    for (const [id, entry] of this.pending) if (performance.now() - entry.at > 10_000) {
      this.pending.delete(id); if (entry.sample) entry.sample.outcome = "observer_timeout";
      this.count("observer_timeout"); this.send({ type: "cancel", id });
    }
    return true;
  }
  private begin(attempt: Readonly<ShadowAttempt>) {
    if (this.stopped || !this.allowed() || attempt.proxied || !officialGateway(attempt.gateway)) return;
    this.syncConsumerAssets();
    const started = performance.now(), id = ++this.serial, generation = this.streamGeneration;
    this.count("attempt_seen");
    // Explicit allowlist: no arbitrary caller properties or credentials enter messages/reports.
    const short = (value?: string) => value?.slice(0, 256);
    const identity = { tokenId: attempt.tokenId.slice(0, 256), role: attempt.role.slice(0, 32),
      attemptId: short(attempt.attemptId), executionId: short(attempt.executionId), leg: short(attempt.leg)!,
      linkId: Number.isFinite(attempt.linkId) ? attempt.linkId : undefined };
    const excluded = this.failure ?? (!this.channel ? "consumer_unavailable" : undefined) ?? (this.pending.size >= 32 ? "attempt_capacity" : undefined);
    const input = copySimulationInput(attempt.simulation);
    const simulationExcluded = this.simulationFailures.get(attempt.tokenId) ?? excluded;
    let actualHttp: { price?: number; bookOdds?: number; depthAvailableAtCap?: number; depthNeedUsdc?: number } | undefined;
    let simulation: SimulationObservation | undefined, completedSample: ShadowSample | undefined, httpOptions: PolymarketOrderOptions | undefined;
    const compareSimulation = () => {
      if (!completedSample || !simulation) return;
      completedSample.simulation = { ...simulation.report };
      completedSample.simulationMs = simulation.report.totalMs;
      if (this.stopped || !this.allowed() || generation !== this.streamGeneration) {
        completedSample.simulation = { ...simulation.report, decision: "canceled", reason: "scope_or_stream_changed" };
        this.count("simulation_canceled"); return;
      }
      this.count(`simulation_${simulation.report.decision}`);
      this.count(`simulation_reason_${simulation.report.reason}`);
      if (simulation.report.decision !== "local_candidate") {
        if (simulation.report.decision === "http_fallback") completedSample.fallbackResult = completedSample.httpFailed ? "existing_http_failure" : "existing_http_success";
        return;
      }
      if (completedSample.httpFailed) { completedSample.simulationComparison = "http_rejected"; return; }
      if (!input || !httpOptions || !simulation.options || !actualHttp
        || ![actualHttp.price, actualHttp.bookOdds, actualHttp.depthAvailableAtCap, actualHttp.depthNeedUsdc].every(Number.isFinite)) {
        completedSample.simulationComparison = "http_shape_unknown"; return;
      }
      if (httpOptions.bookTimestamp !== simulation.options.bookTimestamp || JSON.stringify(httpOptions.asks) !== JSON.stringify(simulation.options.asks)) {
        completedSample.simulationComparison = "unaligned_or_changed"; return;
      }
      try {
        const quote = simulateExecutableBuy(input, httpOptions);
        completedSample.simulationComparison = JSON.stringify(quote) === JSON.stringify(simulation.report.quote)
          && quote.price === actualHttp.price && quote.bookOdds === actualHttp.bookOdds
          && quote.depthAvailableAtCap === actualHttp.depthAvailableAtCap && quote.depthNeedUsdc === actualHttp.depthNeedUsdc
          && httpOptions.version === simulation.options.version && httpOptions.negRisk === simulation.options.negRisk
          && httpOptions.tickSize === simulation.options.tickSize && httpOptions.minOrderSize === simulation.options.minOrderSize
          ? "aligned_equal" : "aligned_difference";
      } catch { completedSample.simulationComparison = "aligned_difference"; }
      if (completedSample.simulationComparison === "aligned_difference") this.simulationFailures.set(attempt.tokenId, "simulation_difference");
      if (completedSample.simulationComparison === "aligned_equal" && !["comparison_pending", "aligned_equal"].includes(completedSample.outcome))
        completedSample.simulationComparison = completedSample.outcome;
    };
    if (input && input.tokenId === attempt.tokenId && !simulationExcluded && this.lease) {
      // Metadata is frozen BEFORE HTTP begins. This attempt's HTTP result cannot seed its own local candidate.
      const metadata = this.executionMetadata.find(row => row.asset === input.tokenId);
      void simulateLocalSource(input, this.lease, metadata ? { ...metadata } : undefined,
        () => !this.stopped && this.allowed() && generation === this.streamGeneration && !!this.service.report().worker, attempt.tick)
        .then(result => { simulation = result; compareSimulation(); }).catch(() => { this.count("simulation_error"); });
    } else if (attempt.simulation) {
      simulation = { report: { mode: "simulation", executionSource: "existing-http", decision: "http_fallback",
        reason: simulationExcluded ?? "invalid_simulation_input", totalMs: 0 } };
    }
    if (!excluded) {
      this.pending.set(id, { at: started, generation });
      this.send({ type: "begin", id, sentAt: observerClock(), attempt: { ...identity, gateway: "https://clob.polymarket.com", tick: attempt.tick, proxied: false } });
    }
    const httpStarted = performance.now(); // Exclude begin-message construction/clone from HTTP waiting.
    const metadataClockAt = performance.timeOrigin + httpStarted;
    let finished = false;
    return (raw: unknown, failed: boolean) => {
      if (finished) return; finished = true;
      const completed = performance.now();
      const entry = this.pending.get(id);
      const outcome = this.stopped ? "scope_stopped" : !this.allowed() || generation !== this.streamGeneration ? "epoch_or_route_changed"
        : excluded ?? this.failure ?? (!entry ? "observer_timeout" : "comparison_pending");
      const sample: ShadowSample = { at: Date.now(), source: "attempt", ...identity, observerId: id, outcome,
        httpMs: completed - httpStarted, httpFailed: failed };
      completedSample = sample;
      const fields = raw as typeof actualHttp;
      if (fields) actualHttp = { price: fields.price, bookOdds: fields.bookOdds,
        depthAvailableAtCap: fields.depthAvailableAtCap, depthNeedUsdc: fields.depthNeedUsdc };
      const supplied = (raw as { orderOptions?: PolymarketOrderOptions } | undefined)?.orderOptions;
      if (input && supplied && Array.isArray(supplied.asks) && supplied.asks.length <= BOOK_LIMITS.levels) {
        httpOptions = { version: supplied.version, bookTimestamp: supplied.bookTimestamp, tickSize: supplied.tickSize,
          minOrderSize: supplied.minOrderSize, negRisk: supplied.negRisk, asks: supplied.asks.map(row => ({ price: row.price, size: row.size })) };
      }
      compareSimulation();
      this.samples.push(sample); if (this.samples.length > 256) this.samples.shift();
      this.count("attempt_completed"); this.count(failed ? "http_rejected" : "http_resolved");
      if (outcome !== "comparison_pending") {
        this.count(outcome); this.pending.delete(id);
        if (entry && this.channel) this.send({ type: "cancel", id });
        return;
      }
      const http = raw as ShadowHttpSummary | undefined, asks = http?.orderOptions?.asks;
      // Never post the raw HTTP result: bounded numeric depth + scalar diagnostics only.
      let summary: ShadowHttpSummary | undefined;
      if (Array.isArray(asks) && asks.length <= BOOK_LIMITS.levels && asks.every(row => Number.isFinite(row.price) && Number.isFinite(row.size)))
        summary = { price: Number.isFinite(http?.price) ? http?.price : undefined,
          metadataClockAt,
          orderOptions: { bookTimestamp: Number.isFinite(http?.orderOptions?.bookTimestamp) ? http?.orderOptions?.bookTimestamp : undefined,
          version: Number.isFinite(http?.orderOptions?.version) ? http?.orderOptions?.version : undefined,
          tickSize: typeof http?.orderOptions?.tickSize === "string" ? http.orderOptions.tickSize.slice(0, 16) : undefined,
          minOrderSize: Number.isFinite(http?.orderOptions?.minOrderSize) ? http?.orderOptions?.minOrderSize : undefined,
          negRisk: typeof http?.orderOptions?.negRisk === "boolean" ? http.orderOptions.negRisk : undefined,
          asks: asks.map(row => ({ price: row.price, size: row.size })) } };
      sample.httpFillPrice = summary?.price;
      entry!.sample = sample;
      if (!this.send({ type: "finish", id, raw: summary, failed, sentAt: observerClock() })) sample.outcome = this.failure ?? "consumer_unavailable";
    };
  }
  report() {
    const durations = (field: "httpMs" | "localReadMs" | "compareMs" | "observerQueueMs" | "beginQueueMs" | "simulationMs", role = "execute") => {
      const values = this.samples.filter(row => row.role === role).map(row => row[field]).filter((n): n is number => n != null).sort((a, b) => a - b);
      return { count: values.length, p50: values.length ? values[Math.ceil(values.length * .5) - 1] : null,
        p95: values.length ? values[Math.ceil(values.length * .95) - 1] : null };
    };
    const service = this.service.report(), assets = this.requestedIds.filter(id => service.ids.includes(id)).length;
    if (!service.worker || service.generation !== this.consumerGeneration) this.latest = undefined;
    return { mode: "shadow", executionSource: "existing-http", activeSupported: false, worker: !this.stopped && service.worker,
      failure: this.failure, assets, pendingComparisons: this.pending.size,
      feed: "passive-pm-m", requestedAssets: this.requestedIds.length, uncoveredAssets: this.requestedIds.length - assets,
      streamOpen: service.streamOpen, streamEpoch: service.streamEpoch, pendingStream: service.mailbox.pendingEntries,
      pendingStreamChars: service.mailbox.pendingChars, mailbox: service.mailbox,
      pendingHttp: (this.counters.attempt_seen ?? 0) - (this.counters.attempt_completed ?? 0),
      routes: { marketWs: "official", http: "direct", submit: "direct" },
      limits: { ...BOOK_LIMITS, comparisons: 32, observerTimeoutMs: 10_000, recentAttempts: 256, mailbox: MAILBOX_LIMITS },
      coverage: this.latest?.coverage,
      snapshotsInMemory: this.latest?.snapshotsInMemory ?? 0, metadataInMemory: this.latest?.metadataInMemory ?? 0,
      counters: { ...this.counters }, workerCounters: { ...this.latest?.counters },
      httpMarketMs: durations("httpMs"), precheckOnlyHttpMs: durations("httpMs", "precheckOnly"),
      localReadMs: durations("localReadMs"), compareMs: durations("compareMs"), observerQueueMs: durations("observerQueueMs"), beginQueueMs: durations("beginQueueMs"),
      samples: [...(this.latest?.samples ?? []), ...this.samples].map(row => ({ ...row })),
      simulation: { supported: true, activeSupported: false, executionSource: "existing-http",
        failure: this.simulationFailures.size ? "simulation_difference" : undefined,
        failedAssets: [...this.simulationFailures.keys()], totalMs: durations("simulationMs"),
        completed: this.samples.filter(row => row.simulation).length,
        localCandidates: this.samples.filter(row => row.simulation?.decision === "local_candidate").length,
        httpFallbacks: this.samples.filter(row => row.simulation?.decision === "http_fallback").length },
      note: "HTTP denominator includes failed/invalidated/capacity attempts; percentiles cover last 256 completions. No fill-rate evidence." };
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer); this.unobserve(); this.channel?.release(); this.lease?.release();
    for (const entry of this.pending.values()) if (entry.sample) entry.sample.outcome = "scope_stopped";
    this.pending.clear(); this.latest = undefined; this.requestedIds = []; this.executionMetadata = []; this.simulationFailures.clear();
  }
}
