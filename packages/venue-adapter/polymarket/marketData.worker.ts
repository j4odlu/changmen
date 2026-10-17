// Application composition: the independent book engine never imports its dynamic consumer.
import { BookStore } from "./realtime/orderBook/bookStore";
import type { ServiceMessage, ServiceRequest, ServiceResponse } from "./realtime/orderBook/serviceProtocol";
import { WsBookShadowRuntime } from "./submission/preflight/optimized/wsBook/bookRuntime";
import { beginWsBookShadow } from "./submission/preflight/optimized/wsBook/shadowObserver";
import { observerClock, type ShadowWorkerRequest, type ShadowWorkerResponse } from "./submission/preflight/optimized/wsBook/shadowWorkerProtocol";

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<ServiceMessage>) => void) | null; postMessage(message: ServiceResponse): void };
const books = new BookStore(() => true);
let consumer: WsBookShadowRuntime | undefined, consumerScope = 0, generation = 0, watched = false;
let processedSequence = 0;
let reportTimer: ReturnType<typeof setInterval> | undefined;
const pending = new Map<number, { finish: ReturnType<typeof beginWsBookShadow>; beginQueueMs: number }>();
const respond = (payload: ShadowWorkerResponse) => scope.postMessage({ type: "consumer", scope: consumerScope, payload });
function report(): void {
  if (!consumer) return;
  publishMetadata();
  const { executionMetadata: _metadata, ...value } = consumer.report();
  respond({ type: "report", generation, report: { ...value, samples: value.samples.filter(row => row.source === "probe").slice(-32) } });
}
let metadataRevision = 0, metadataSignature = "";
function publishMetadata(): void {
  if (!consumer) return;
  const entries = consumer.executionMetadata();
  const signature = JSON.stringify([generation, entries]);
  if (signature === metadataSignature) return;
  metadataSignature = signature;
  respond({ type: "metadata", generation, revision: ++metadataRevision, entries });
}
let reportQueued = false;
function metadataChanged(): void {
  if (reportQueued) return;
  reportQueued = true;
  // Publish after this FIFO batch, when source generation and assets are fully applied.
  queueMicrotask(() => { reportQueued = false; publishMetadata(); });
}
function detach(): void {
  consumer?.stop(); consumer = undefined; pending.clear(); metadataSignature = "";
  if (reportTimer) clearInterval(reportTimer); reportTimer = undefined;
}
function diagnostic(data: ShadowWorkerRequest): void {
  if (!consumer) return;
  if (data.type === "assets") consumer.setAssets(data.ids);
  else if (data.type === "begin") {
    if (pending.size < 32) pending.set(data.id, { finish: beginWsBookShadow(data.attempt), beginQueueMs: Math.max(0, observerClock() - data.sentAt) });
  } else if (data.type === "cancel") { pending.get(data.id)?.finish(undefined, true); pending.delete(data.id); }
  else if (data.type === "finish") {
    const entry = pending.get(data.id); pending.delete(data.id); if (!entry) return;
    entry.finish(data.raw, data.failed);
    const sample = consumer.report().samples.at(-1);
    if (sample) respond({ type: "sample", id: data.id, sample: { ...sample, observerQueueMs: Math.max(0, observerClock() - data.sentAt), beginQueueMs: entry.beginQueueMs } });
  }
}
function process(data: ServiceRequest): void {
  if (data.type === "stream") { books.feed.accept?.(data.event); generation = data.generation;
    processedSequence = data.event.type === "frame" ? data.event.sequence : 0; }
  else if (data.type === "assets") { books.feed.setAssets(data.ids); generation = data.generation; }
  else if (data.type === "depth") scope.postMessage({ type: "depth", id: data.id, generation, view: books.depth(data.asset, data.levels) });
  else if (data.type === "full_book") scope.postMessage({ type: "full_book", id: data.id, generation,
    view: observerClock() > data.deadline ? { asset: data.asset, status: "read_timeout", generation: books.reader.generation }
      : { ...books.fullBook(data.asset), processedSequence } });
  else if (data.type === "watch") watched = data.enabled;
  else if (data.type === "attach") {
    detach(); consumerScope = data.scope; consumer = new WsBookShadowRuntime(() => true, books.reader, { onMetadata: metadataChanged });
    reportTimer = setInterval(report, 1_000);
  } else if (data.scope === consumerScope) {
    if (data.type === "detach") detach();
    else { try { diagnostic(data.payload as ShadowWorkerRequest); } catch { detach(); } }
  }
}
books.reader.onInvalidate(({ assets }) => { scope.postMessage({ type: "book_invalidated", assets }); if (watched) scope.postMessage({ type: "changed" }); });
let changeTimer: ReturnType<typeof setInterval> | undefined;
let notifiedRevision = -1, notifiedSecond = -1;
scope.onmessage = ({ data }) => {
  if (data.type !== "batch") return;
  for (const request of data.requests) process(request);
  if (watched && !changeTimer) changeTimer = setInterval(() => {
    const second = Math.floor(performance.now() / 1000);
    if (books.revision !== notifiedRevision || second !== notifiedSecond) {
      notifiedRevision = books.revision; notifiedSecond = second; scope.postMessage({ type: "changed" });
    }
  }, 100);
  if (!watched && changeTimer) { clearInterval(changeTimer); changeTimer = undefined; }
  scope.postMessage({ type: "batch_ack", id: data.id });
};
