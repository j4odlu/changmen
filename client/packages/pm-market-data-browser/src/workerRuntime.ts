import { BookStore } from "./bookStore";
import type { BookReader } from "./bookStore";
import type { ServiceMessage, ServiceRequest, ServiceResponse } from "./serviceProtocol";

export interface BookWorkerScope {
  onmessage: ((event: MessageEvent<ServiceMessage>) => void) | null;
  postMessage(message: ServiceResponse): void;
}
/** [changmen 扩展] Optional diagnostics see public books and their own message channel only. */
export interface BookWorkerDiagnostics {
  receive(payload: unknown): void;
  stop(): void;
}
export interface BookWorkerDiagnosticPorts {
  books: BookReader;
  generation(): number;
  post(payload: unknown): void;
}
export type BookWorkerDiagnosticFactory = (ports: BookWorkerDiagnosticPorts) => BookWorkerDiagnostics;

/** Shared FIFO loop. No default diagnostic consumer, HTTP, account or platform import. */
export function startPmBookWorker(scope: BookWorkerScope, createDiagnostics?: BookWorkerDiagnosticFactory): void {
  const books = new BookStore(() => true);
  let consumer: BookWorkerDiagnostics | undefined, consumerScope = 0, generation = 0, watched = false;
  let processedSequence = 0, diagnosticGeneration = 0;
  const detach = () => {
    ++diagnosticGeneration;
    const previous = consumer; consumer = undefined;
    try { previous?.stop(); } catch { /* optional consumer cannot terminate the public book */ }
  };
  const clock = () => performance.timeOrigin + performance.now();
  function process(data: ServiceRequest): void {
    if (data.type === "stream") { books.feed.accept?.(data.event); generation = data.generation;
      processedSequence = data.event.type === "frame" ? data.event.sequence : 0; }
    else if (data.type === "assets") { books.feed.setAssets(data.ids); generation = data.generation; }
    else if (data.type === "depth") scope.postMessage({ type: "depth", id: data.id, generation, view: books.depth(data.asset, data.levels) });
    else if (data.type === "full_book") scope.postMessage({ type: "full_book", id: data.id, generation,
      view: clock() > data.deadline ? { asset: data.asset, status: "read_timeout", generation: books.reader.generation }
        : { ...books.fullBook(data.asset), processedSequence } });
    else if (data.type === "watch") watched = data.enabled;
    else if (data.type === "attach") {
      detach(); consumerScope = data.scope;
      const ticket = diagnosticGeneration, channel = data.scope;
      try {
        consumer = createDiagnostics?.({ books: books.reader, generation: () => generation,
          post: payload => {
            if (ticket === diagnosticGeneration && channel === consumerScope)
              scope.postMessage({ type: "consumer", scope: channel, payload });
          } });
      } catch { ++diagnosticGeneration; consumer = undefined; }
    } else if (data.scope === consumerScope) {
      if (data.type === "detach") detach();
      else { try { consumer?.receive(data.payload); } catch { detach(); } }
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
}
