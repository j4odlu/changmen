import { afterEach, expect, test, vi } from "vitest";
const worker = vi.hoisted(() => ({ start: vi.fn(), diagnostics: vi.fn() }));
vi.mock("@changmen/pm-market-data-browser/workerRuntime", () => ({ startPmBookWorker: worker.start }));
vi.mock("@changmen/venue-browser/pm-book-diagnostics/workerDiagnostics", () => ({ createPmBookDiagnostics: worker.diagnostics }));
afterEach(() => { vi.resetModules(); worker.start.mockClear(); });

test.each(["legacy", "web"])("%s entry and public package share one startup with the same diagnostic factory", async first => {
  vi.resetModules();
  const legacy = () => import("../../../../packages/venue-adapter/polymarket/marketData.worker");
  const web = () => import("./pmMarketData.worker");
  if (first === "legacy") { await legacy(); await web(); } else { await web(); await legacy(); }
  await import("@changmen/venue-browser/pm-book-diagnostics/marketData.worker");
  expect(worker.start).toHaveBeenCalledExactlyOnceWith(globalThis, worker.diagnostics);
});
