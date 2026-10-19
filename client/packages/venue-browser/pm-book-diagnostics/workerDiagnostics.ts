import type { BookWorkerDiagnosticFactory } from "@changmen/pm-market-data-browser/workerRuntime";
import { WsBookShadowRuntime } from "./bookRuntime";
import { beginWsBookShadow } from "./shadowObserver";
import { observerClock, type ShadowWorkerRequest, type ShadowWorkerResponse } from "./shadowWorkerProtocol";

/** [changmen 扩展] Dynamic HTTP comparison is a consumer of the public book, not its owner. */
let metadataRevision = 0;
export const createPmBookDiagnostics: BookWorkerDiagnosticFactory = ports => {
  const pending = new Map<number, { finish: ReturnType<typeof beginWsBookShadow>; beginQueueMs: number }>();
  const respond = (payload: ShadowWorkerResponse) => ports.post(payload);
  let metadataSignature = "", reportQueued = false;
  function publishMetadata(): void {
    const entries = consumer.executionMetadata(), generation = ports.generation();
    const signature = JSON.stringify([generation, entries]);
    if (signature === metadataSignature) return;
    metadataSignature = signature;
    respond({ type: "metadata", generation, revision: ++metadataRevision, entries });
  }
  function metadataChanged(): void {
    if (reportQueued) return;
    reportQueued = true;
    queueMicrotask(() => { reportQueued = false; if (!stopped) publishMetadata(); });
  }
  let stopped = false;
  const consumer = new WsBookShadowRuntime(() => true, ports.books, { onMetadata: metadataChanged });
  const reportTimer = setInterval(() => {
    publishMetadata();
    const { executionMetadata: _metadata, ...value } = consumer.report();
    respond({ type: "report", generation: ports.generation(), report: { ...value, samples: value.samples.filter(row => row.source === "probe").slice(-32) } });
  }, 1_000);
  return {
    receive(payload: unknown): void {
      const data = payload as ShadowWorkerRequest;
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
    },
    stop(): void { stopped = true; consumer.stop(); pending.clear(); clearInterval(reportTimer); },
  };
};
