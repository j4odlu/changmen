import { afterEach, expect, test, vi } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { startPmBookWorker, type BookWorkerScope, type BookWorkerDiagnosticFactory, type BookWorkerDiagnosticPorts } from "../src/workerRuntime";
import type { ServiceRequest, ServiceResponse } from "../src/serviceProtocol";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const snapshot = { event_type: "book", asset_id: "1", market: "m", timestamp: "1792200000000", hash: "h", bids: [], asks: [{ price: "0.5", size: "7" }] };
function fixture(factory?: BookWorkerDiagnosticFactory) {
  vi.useFakeTimers();
  const messages: ServiceResponse[] = [], scope: BookWorkerScope = { onmessage: null, postMessage: value => messages.push(value) };
  startPmBookWorker(scope, factory);
  let id = 0;
  const send = (requests: ServiceRequest[]) => scope.onmessage!({ data: { type: "batch", id: ++id, requests } } as MessageEvent);
  send([{ type: "assets", ids: ["1"], generation: 1 }, { type: "stream", generation: 1, event: { type: "state", state: { epoch: 1, source: "official", open: true } } },
    { type: "stream", generation: 1, event: { type: "frame", epoch: 1, sequence: 1, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(), raw: JSON.stringify(snapshot) } }]);
  return { messages, send };
}
test("package and plain Worker bundle contain only browser core source", async () => {
  for (const name of ["index.ts", "marketData.worker.ts"]) {
    const result = await build({ absWorkingDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      entryPoints: [fileURLToPath(new URL(`../src/${name}`, import.meta.url))], bundle: true, write: false, platform: "browser", metafile: true });
    expect(Object.keys(result.metafile!.inputs).every(path => path.includes("client/packages/pm-market-data-browser/src/"))).toBe(true);
    expect(result.outputFiles[0]!.text).not.toMatch(/\b(?:WebSocket|fetch|XMLHttpRequest)\s*\(/);
  }
});
test("plain Worker full reads preserve sequence, deadline and FIFO ACK without any diagnostics", () => {
  const f = fixture();
  f.send([{ type: "full_book", id: 1, asset: "1", generation: 1, deadline: performance.timeOrigin + performance.now() + 1000 },
    { type: "full_book", id: 2, asset: "1", generation: 1, deadline: performance.timeOrigin + performance.now() - 1 }]);
  expect(f.messages.find(row => row.type === "full_book" && row.id === 1)).toMatchObject({ view: { status: "ready", processedSequence: 1, asks: [{ price: "0.5", size: "7" }] } });
  expect(f.messages.find(row => row.type === "full_book" && row.id === 2)).toMatchObject({ view: { status: "read_timeout" } });
  expect(f.messages.at(-1)?.type).toBe("batch_ack");
});
test("diagnostic exceptions and detach keep public books; stale channel callbacks cannot reach a new scope", () => {
  const ports: BookWorkerDiagnosticPorts[] = [], stop = vi.fn(() => { throw Error("diagnostic stop failure"); });
  const f = fixture(port => { ports.push(port); return { receive: () => { throw Error("diagnostic failure"); }, stop }; });
  f.send([{ type: "attach", scope: 1 }, { type: "consumer", scope: 1, payload: {} }]);
  f.send([{ type: "attach", scope: 2 }, { type: "depth", id: 3, asset: "1", levels: 20, generation: 1 }]);
  ports[0]!.post("late"); ports[1]!.post("current");
  expect(f.messages.filter(row => row.type === "consumer")).toEqual([{ type: "consumer", scope: 2, payload: "current" }]);
  expect(f.messages.find(row => row.type === "depth" && row.id === 3)).toMatchObject({ view: { status: "ready", revision: 1 } });
  expect(stop).toHaveBeenCalledOnce(); f.send([{ type: "detach", scope: 2 }]);
});
test("failed diagnostic construction does not interrupt public depth or batch completion", () => {
  const f = fixture(() => { throw Error("optional consumer unavailable"); });
  f.send([{ type: "attach", scope: 1 }, { type: "depth", id: 1, asset: "1", levels: 20, generation: 1 }]);
  expect(f.messages.find(row => row.type === "depth")).toMatchObject({ view: { status: "ready" } });
  expect(f.messages.at(-1)?.type).toBe("batch_ack");
});
