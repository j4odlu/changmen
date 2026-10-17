import { BOOK_LIMITS } from "./bookReducer";
import type { DepthView, FullBookView } from "./bookStore";
import type { ServiceRequest, ServiceResponse, WorkerPort } from "./serviceProtocol";
import { OrderedWorkerMailbox } from "../orderedWorkerMailbox";
import { observePmMarketStream } from "../marketStream";
import { getPolymarketQuoteConsumerAssetIds } from "../../quotes/marketQuoteHub";
import type { MarketStreamEvent } from "../marketStreamProtocol";

export type Admission = { asset: string; status: "admitted" | "not_subscribed" | "capacity_exceeded" | "invalid_asset" | "stopped" };
export interface BookLease {
  setInterests(ids: readonly string[]): Admission[];
  readDepth(asset: string, levels?: number): Promise<DepthView>;
  readFullBook(asset: string): Promise<FullBookView>;
  isCurrent(view: FullBookView): boolean;
  onChange(fn: () => void): () => void;
  release(): void;
}
export interface DiagnosticChannel {
  send(payload: unknown, chars?: number): boolean;
  release(): void;
}
/** Consumer-facing type excludes owner stop/reconcile and source operations. */
export type BookConsumerPort = Pick<PmOrderBookService, "acquire" | "attachDiagnostics" | "report">;
let sessionSerial = 0;
export const FULL_BOOK_READ_MS = 20;
export const FULL_BOOK_CATCHUPS = 3;
/** [changmen 扩展] Owner of the passive service. Consumers never own the worker or source handle. */
export class PmOrderBookService {
  private sessionId = ++sessionSerial;
  private worker?: WorkerPort;
  private unstream?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private failure?: string;
  private open = false;
  private epoch = 0;
  private generation = 0;
  private serial = 0;
  private ids: string[] = [];
  private leases = new Map<number, { ids: string[]; listeners: Set<() => void> }>();
  private channels = new Map<number, (payload: unknown) => void>();
  private reads = new Map<number, { lease: number; at: number; asset: string; generation: number; resolve: (view: DepthView) => void }>();
  private frames = 0;
  private sequence = 0;
  private invalidations = 0;
  private assetInvalidations = new Map<string, number>();
  private assetInvalidationSerial = 0;
  private fullReads = new Map<number, { lease: number; asset: string; generation: number; at: number;
    catchups: number; timer: ReturnType<typeof setTimeout>; resolve: (view: FullBookView) => void }>();
  private fullReadStats = { catchups: 0, recovered: 0, exhausted: 0, timeouts: 0 };
  private issued = new WeakMap<FullBookView, { lease: number; generation: number; invalidations: number; assetInvalidations: number }>();
  private chars = 0;
  private watching = false;
  private mailbox = new OrderedWorkerMailbox<ServiceRequest>((id, requests) => this.worker?.postMessage({ type: "batch", id, requests }), reason => this.disable(reason));
  constructor(private allowed: () => boolean, factory: () => WorkerPort,
    private roster = () => getPolymarketQuoteConsumerAssetIds("esport"),
    observe = observePmMarketStream) {
    try {
      if (!allowed()) throw Error("not authorized");
      this.worker = factory();
      this.worker.onmessage = event => this.receive(event.data as ServiceResponse);
      this.worker.onerror = this.worker.onmessageerror = () => this.disable("worker_failed");
      try {
        const release = observe(event => this.forward(event));
        if (this.worker) this.unstream = release; else release();
      } catch { this.disable("stream_observer_unavailable"); }
    } catch { this.disable("worker_unavailable"); }
    if (this.worker) this.timer = setInterval(() => this.reconcile(), 1_000);
  }
  private send(message: ServiceRequest, chars = 8192): boolean {
    return !!this.worker && !this.stopped && this.mailbox.enqueue(message, chars);
  }
  private forward(event: MarketStreamEvent): void {
    if (!this.worker || this.stopped) return;
    if (event.type === "state") {
      if (!this.allowed()) { this.stop(); return; }
      if (event.state.epoch < this.epoch) return;
      this.open = event.state.open && event.state.source === "official"; this.epoch = event.state.epoch; ++this.generation;
      this.sequence = 0;
      this.cancelReads("stream_changed");
    } else if (!this.open || event.epoch !== this.epoch) return;
    if (event.type === "state") this.syncAssets();
    const chars = event.type === "frame" ? event.raw.length : 8192;
    if (chars > BOOK_LIMITS.frameChars) { this.disable("stream_overflow"); return; }
    if (event.type === "frame") { ++this.frames; this.chars += chars; this.sequence = event.sequence; }
    this.send({ type: "stream", event, generation: this.generation }, chars);
    if (event.type === "state") this.notify();
  }
  private syncAssets(): void {
    if (!this.worker || this.stopped) return;
    const source = new Set(this.open ? this.roster().filter(id => /^\d{1,256}$/.test(id)) : []);
    const wanted = new Set([...this.leases.values()].flatMap(lease => lease.ids));
    // Preserve already leased books, then admit interests, then retain/fill the warm pool.
    const next = [...new Set([...this.ids.filter(id => wanted.has(id)), ...wanted, ...this.ids, ...source])]
      .filter(id => source.has(id)).slice(0, BOOK_LIMITS.assets);
    if (next.join(",") === this.ids.join(",")) return;
    const removed = this.ids.filter(asset => !next.includes(asset));
    for (const asset of this.assetInvalidations.keys()) if (!next.includes(asset)) this.assetInvalidations.delete(asset);
    for (const asset of next) if (!this.assetInvalidations.has(asset)) this.assetInvalidations.set(asset, ++this.assetInvalidationSerial);
    this.ids = next; this.cancelReads("assets_changed", undefined, removed);
    this.send({ type: "assets", ids: next, generation: this.generation }); this.notify();
  }
  acquire(): BookLease {
    if (this.leases.size >= 4 || this.stopped || !this.worker) throw Error(this.failure ?? "consumer_capacity_or_stopped");
    const id = ++this.serial, entry = { ids: [] as string[], listeners: new Set<() => void>() }; this.leases.set(id, entry);
    return Object.freeze({
      setInterests: (assets: readonly string[]): Admission[] => {
        const requested = [...new Set(assets)];
        if (!this.leases.has(id) || !this.worker) return requested.map(asset => ({ asset, status: "stopped" }));
        entry.ids = requested.filter(asset => /^\d{1,256}$/.test(asset)).slice(0, 64); this.syncAssets();
        const source = new Set(this.roster());
        return requested.map(asset => ({ asset, status: !/^\d{1,256}$/.test(asset) ? "invalid_asset" : !this.open || !source.has(asset)
          ? "not_subscribed" : entry.ids.includes(asset) && this.ids.includes(asset) ? "admitted" : "capacity_exceeded" }));
      },
      readDepth: (asset: string, levels = 20) => this.read(id, asset, levels),
      readFullBook: (asset: string) => this.readFull(id, asset),
      isCurrent: (view: FullBookView) => {
        const issued = this.issued.get(view);
        return !!issued && issued.lease === id && this.leases.has(id) && issued.generation === this.generation && issued.invalidations === this.invalidations && issued.assetInvalidations === (this.assetInvalidations.get(view.asset) ?? 0)
          && this.ids.includes(view.asset) && this.leases.get(id)!.ids.includes(view.asset)
          && !!this.worker && !this.stopped && this.open && this.allowed() && view.processedSequence === this.sequence
          && view.sessionId === this.sessionId && view.streamEpoch === this.epoch;
      },
      onChange: (fn: () => void) => { if (entry.listeners.size >= 4) throw Error("listener_capacity"); if (this.leases.has(id)) entry.listeners.add(fn); this.syncWatch(); return () => { entry.listeners.delete(fn); this.syncWatch(); }; },
      release: () => { this.leases.delete(id); this.cancelReads("consumer_released", id); entry.listeners.clear(); this.syncAssets(); this.syncWatch(); },
    });
  }
  /** Internal composition port; ordinary depth leases have no diagnostic or invalidation authority. */
  attachDiagnostics(receive: (payload: unknown) => void): DiagnosticChannel {
    if (this.channels.size || !this.worker || this.stopped) throw Error("diagnostic_unavailable");
    const scope = ++this.serial; this.channels.set(scope, receive); this.send({ type: "attach", scope });
    return { send: (payload, chars = 8192) => this.channels.has(scope) && this.send({ type: "consumer", scope, payload }, chars),
      release: () => { if (this.channels.delete(scope)) this.send({ type: "detach", scope }); } };
  }
  private read(lease: number, asset: string, levels: number): Promise<DepthView> {
    this.syncAssets();
    const reason = !this.worker || !this.leases.has(lease) ? this.failure ?? "stopped" : !this.leases.get(lease)!.ids.includes(asset)
      ? "not_requested" : !this.ids.includes(asset) ? "not_admitted" : this.reads.size + this.fullReads.size >= 32 ? "read_capacity" : undefined;
    if (reason) return Promise.resolve({ asset, status: reason, generation: this.generation });
    const id = ++this.serial;
    return new Promise(resolve => {
      this.reads.set(id, { lease, asset, generation: this.generation, at: performance.now(), resolve });
      this.send({ type: "depth", id, asset, levels: Number.isFinite(levels) ? Math.min(50, Math.max(1, Math.floor(levels))) : 20, generation: this.generation });
    });
  }
  private readFull(lease: number, asset: string): Promise<FullBookView> {
    if (!this.allowed()) return Promise.resolve({ asset, status: "not_authorized", generation: this.generation });
    this.syncAssets();
    const reason = !this.worker || this.stopped || !this.open || !this.leases.has(lease) ? this.failure ?? "stopped"
      : !this.leases.get(lease)!.ids.includes(asset) ? "not_requested" : !this.ids.includes(asset) ? "not_admitted"
      : this.reads.size + this.fullReads.size >= 32 ? "read_capacity" : undefined;
    if (reason) return Promise.resolve({ asset, status: reason, generation: this.generation });
    const id = ++this.serial, at = performance.now();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        const entry = this.fullReads.get(id); if (!entry) return;
        this.fullReads.delete(id); ++this.fullReadStats.timeouts; resolve({ asset, status: "read_timeout", generation: this.generation });
      }, FULL_BOOK_READ_MS);
      this.fullReads.set(id, { lease, asset, generation: this.generation, at, catchups: 0, timer, resolve });
      if (!this.send({ type: "full_book", id, asset, generation: this.generation, deadline: performance.timeOrigin + at + FULL_BOOK_READ_MS }))
        this.cancelReads("send_failed", lease);
    });
  }
  private receive(message: ServiceResponse): void {
    if (this.stopped || !this.worker) return;
    if (message.type === "batch_ack") { this.mailbox.ack(message.id); return; }
    if (message.type === "changed") { this.notify(); return; }
    if (message.type === "book_invalidated") {
      if (message.assets) {
        for (const asset of message.assets) if (this.ids.includes(asset))
          this.assetInvalidations.set(asset, ++this.assetInvalidationSerial);
      } else ++this.invalidations;
      this.cancelReads("book_invalidated", undefined, message.assets); return;
    }
    if (message.type === "full_book") {
      const entry = this.fullReads.get(message.id); if (!entry) return;
      const reason = !this.allowed() ? "not_authorized" : performance.now() - entry.at > FULL_BOOK_READ_MS ? "read_timeout"
        : entry.generation !== this.generation || entry.generation !== message.generation ? "generation_changed"
        : message.view.asset !== entry.asset ? "identity_changed"
        : message.view.status === "read_timeout" ? "read_timeout"
        : message.view.processedSequence !== this.sequence ? "stream_advanced" : undefined;
      // Process EVERY intervening frame before reading again. Never extend the original
      // deadline or accept a view behind ingress, even for unrelated assets/PONG.
      if (reason === "stream_advanced" && Number.isSafeInteger(message.view.processedSequence)
        && message.view.processedSequence! < this.sequence && entry.catchups < FULL_BOOK_CATCHUPS) {
        ++entry.catchups; ++this.fullReadStats.catchups;
        if (!this.send({ type: "full_book", id: message.id, asset: entry.asset, generation: entry.generation,
          deadline: performance.timeOrigin + entry.at + FULL_BOOK_READ_MS })) this.cancelReads("send_failed", entry.lease);
        return;
      }
      this.fullReads.delete(message.id); clearTimeout(entry.timer);
      if (reason === "read_timeout") ++this.fullReadStats.timeouts;
      if (reason === "stream_advanced") ++this.fullReadStats.exhausted;
      if (reason) { entry.resolve({ asset: entry.asset, status: reason, generation: this.generation }); return; }
      if (entry.catchups && message.view.status === "ready") ++this.fullReadStats.recovered;
      const view = { ...message.view, sessionId: this.sessionId, streamEpoch: this.epoch };
      for (const side of [view.bids, view.asks]) if (side) { side.forEach(Object.freeze); Object.freeze(side); }
      Object.freeze(view); this.issued.set(view, { lease: entry.lease, generation: entry.generation, invalidations: this.invalidations, assetInvalidations: this.assetInvalidations.get(entry.asset) ?? 0 }); entry.resolve(view); return;
    }
    if (message.type === "consumer") {
      try { this.channels.get(message.scope)?.(message.payload); } catch { const scope = message.scope; this.channels.delete(scope); this.send({ type: "detach", scope }); }
    } else {
      const entry = this.reads.get(message.id); if (!entry) return; this.reads.delete(message.id);
      const view = { ...message.view, sessionId: this.sessionId, streamEpoch: this.epoch };
      for (const side of [view.bids, view.asks]) if (side) { side.forEach(Object.freeze); Object.freeze(side); }
      entry.resolve(entry.generation === message.generation && entry.generation === this.generation ? Object.freeze(view)
        : { asset: entry.asset, status: "generation_changed", generation: this.generation });
    }
  }
  private cancelReads(status: string, lease?: number, assets?: readonly string[]): void {
    for (const [id, entry] of this.fullReads) if ((lease === undefined || entry.lease === lease) && (!assets || assets.includes(entry.asset))) {
      this.fullReads.delete(id); clearTimeout(entry.timer); entry.resolve({ asset: entry.asset, status, generation: this.generation });
    }
    for (const [id, entry] of this.reads) if ((lease === undefined || entry.lease === lease) && (!assets || assets.includes(entry.asset))) {
      this.reads.delete(id); entry.resolve({ asset: entry.asset, status, generation: this.generation });
    }
  }
  private notify(): void {
    let removed = false;
    for (const entry of this.leases.values()) for (const fn of entry.listeners) { try { fn(); } catch { entry.listeners.delete(fn); removed = true; } }
    if (removed) this.syncWatch();
  }
  private syncWatch(): void {
    const enabled = [...this.leases.values()].some(entry => entry.listeners.size);
    if (enabled !== this.watching) { this.watching = enabled; this.send({ type: "watch", enabled }); }
  }
  reconcile(): boolean {
    if (this.stopped) return false;
    if (!this.allowed()) { this.stop(); return false; }
    this.syncAssets(); this.mailbox.checkAge();
    for (const [id, entry] of this.reads) if (performance.now() - entry.at > 5_000) {
      this.reads.delete(id); entry.resolve({ asset: entry.asset, status: "read_timeout", generation: this.generation });
    }
    this.notify(); return true;
  }
  report() { return { sessionId: this.sessionId, worker: !!this.worker && !this.stopped, failure: this.failure, assets: this.ids.length, ids: [...this.ids],
    generation: this.generation, streamEpoch: this.epoch, streamOpen: this.open, consumers: this.leases.size, diagnostics: this.channels.size,
      pendingReads: this.reads.size + this.fullReads.size, fullReads: { ...this.fullReadStats }, streamFrames: this.frames, streamChars: this.chars, mailbox: this.mailbox.report(), activeSupported: false }; }
  private disable(reason: string): void {
    this.failure = reason; this.unstream?.(); this.unstream = undefined; this.mailbox.stop();
    if (this.timer) clearInterval(this.timer);
    const worker = this.worker; this.worker = undefined;
    if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
    this.cancelReads(reason); this.notify();
  }
  stop(): void { if (this.stopped) return; this.stopped = true; clearInterval(this.timer); this.disable("service_stopped"); this.leases.clear(); this.channels.clear(); this.ids = []; }
}
