import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WsBookShadowWorkerClient } from "../../submission/preflight/optimized/wsBook/shadowWorkerClient";
import { beginWsBookShadow } from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import { simulateExecutableBuy } from "@changmen/venue-browser/pm-book-diagnostics/executionMath";
import type { BookConsumerPort, BookLease } from "@changmen/venue-browser/polymarket/realtime/orderBook/service";
import type { FullBookView } from "../../realtime/orderBook/bookStore";
import { observerClock } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";
import { runPmBuyPreflight } from "@changmen/venue-browser/polymarket/submission/preflight/pmBuyPreflight";

let client: WsBookShadowWorkerClient, receive: (value: unknown) => void, lease: BookLease, view: FullBookView, allowed: boolean;
const input = { tokenId: "1", detectionOdds: 2, maxPrice: .5, apiBetMoney: 5, depth: { enabled: false, multiplier: 1.5 } };
const attempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "execute", leg: "PM:1", simulation: input };
const options = () => ({ version: 2 as const, bookTimestamp: Date.now(), tickSize: "0.01" as const, minOrderSize: 1, negRisk: false, asks: [{ price: .5, size: 100 }] });
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); allowed = true;
  view = { asset: "1", market: "m", status: "ready", generation: 1, assetGeneration: 1, snapshotEvidence: true, sourceAt: Date.now(), revision: 1,
    snapshotClockAt: observerClock(), receivedClockAt: observerClock(), viewTruncated: false, asks: [{ price: "0.5", size: "100" }], bids: [] };
  lease = { setInterests: vi.fn(), readDepth: vi.fn(), readFullBook: vi.fn(async () => view), isCurrent: () => true, onChange: vi.fn(), release: vi.fn() };
  const port = { acquire: () => lease, attachDiagnostics: (fn: (value: unknown) => void) => { receive = fn; return { send: () => true, release: vi.fn() }; },
    report: () => ({ worker: true, generation: 1, ids: ["1"], streamOpen: true, streamEpoch: 1, diagnostics: 1, mailbox: {} }) } as unknown as BookConsumerPort;
  client = new WsBookShadowWorkerClient(() => allowed, port); client.setAssets(["1"]);
});
afterEach(() => { client.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });
function metadata() {
  receive({ type: "metadata", generation: 1, revision: 1, entries: [{ asset: "1", market: "m", version: 2, tick: "0.01", minSize: 1,
    negRisk: false, at: performance.now(), clockAt: observerClock(), bookGeneration: 1, assetGeneration: 1 }] });
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
test("complete input/read/math/HTTP comparison is observation only, with one unchanged HTTP result", async () => {
  metadata(); const opts = options(), quote = simulateExecutableBuy(input, opts), http = Object.freeze({ ...quote, orderOptions: opts });
  const market = vi.fn(async () => http);
  const result = await runPmBuyPreflight({ provider: "Polymarket", accountId: 0 } as never,
    { type: "Polymarket", target: "Home", itemId: "1", betId: "m", bet: { round: 0 }, match: { providers: {}, pmSport: { live: true, updatedAt: Date.now() } } } as never,
    { gateway: attempt.gateway, sportMode: "optimized", role: "precheckOnly", shadowInput: input, market, runtimeBinding: () => "", missingCredentialsMessage: "unused" });
  await settle();
  expect(result.market.value).toBe(http); expect(market).toHaveBeenCalledOnce();
  expect(client.report().samples.at(-1)).toMatchObject({ simulation: { decision: "local_candidate", executionSource: "existing-http" }, simulationComparison: "aligned_equal" });
});
test("real optimized entry preserves the original HTTP rejection even when local calculation could pass", async () => {
  metadata(); const error = new Error("HTTP rejected"), market = vi.fn(async () => { throw error; });
  await expect(runPmBuyPreflight({ provider: "Polymarket", accountId: 0 } as never,
    { type: "Polymarket", target: "Home", itemId: "1", betId: "m", bet: { round: 0 }, match: { providers: {}, pmSport: { live: true, updatedAt: Date.now() } } } as never,
    { gateway: attempt.gateway, sportMode: "optimized", role: "precheckOnly", shadowInput: input, market, runtimeBinding: () => "", missingCredentialsMessage: "unused" })).rejects.toBe(error);
  await settle(); expect(market).toHaveBeenCalledOnce(); expect(client.report().samples.at(-1)?.httpFailed).toBe(true);
});
test("this attempt's HTTP cannot bootstrap its own missing metadata; original HTTP failure remains a failure", async () => {
  const finish = beginWsBookShadow(attempt); metadata(); finish(undefined, true); await settle();
  expect(client.report().samples.at(-1)).toMatchObject({ httpFailed: true, simulation: { decision: "http_fallback", reason: "metadata_unknown" } });
  expect(lease.readFullBook).not.toHaveBeenCalled();
});
test("local negative and read errors use existing HTTP observation, with no extra request", async () => {
  metadata(); view.asks = [];
  const finish = beginWsBookShadow(attempt); finish({ orderOptions: options() }, false); await settle();
  expect(client.report().samples.at(-1)?.simulation?.decision).toBe("http_fallback");
  vi.mocked(lease.readFullBook).mockRejectedValue(Error("worker"));
  const next = beginWsBookShadow(attempt); next(undefined, true); await settle();
  expect(client.report().samples.at(-1)).toMatchObject({ httpFailed: true, simulation: { decision: "http_fallback" } });
});
test("late local completion after stop never becomes a candidate", async () => {
  metadata(); let resolve!: (view: FullBookView) => void;
  vi.mocked(lease.readFullBook).mockReturnValue(new Promise(done => { resolve = done; }));
  const finish = beginWsBookShadow(attempt); finish({ orderOptions: options() }, false); client.stop(); resolve(view); await settle();
  expect(client.report().samples.at(-1)?.simulation?.decision).toBe("canceled");
});
test("an aligned calculation discrepancy disables later local simulation candidates", async () => {
  metadata(); const opts = options(), http = { ...simulateExecutableBuy(input, opts), price: .49, orderOptions: opts };
  beginWsBookShadow(attempt)(http, false); await settle();
  expect(client.report().samples.at(-1)?.simulationComparison).toBe("aligned_difference");
  beginWsBookShadow(attempt)(http, false); await settle();
  expect(client.report().samples.at(-1)?.simulation?.reason).toBe("simulation_difference");
});


test("diagnostic reports cannot supply execution metadata; stale metadata revisions cannot revive withdrawn parameters", async () => {
  receive({type:"report",generation:1,report:{executionMetadata:[{asset:"1"}],samples:[],counters:{}}});
  beginWsBookShadow(attempt)(undefined,true); await settle();
  expect(client.report().samples.at(-1)?.simulation?.reason).toBe("metadata_unknown");
  metadata(); receive({type:"metadata",generation:1,revision:2,entries:[]}); metadata();
  beginWsBookShadow(attempt)(undefined,true); await settle();
  expect(client.report().samples.at(-1)?.simulation?.reason).toBe("metadata_unknown");
  expect(lease.readFullBook).not.toHaveBeenCalled();
});
