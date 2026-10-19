import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BookLease } from "@changmen/venue-browser/polymarket/realtime/orderBook/service";
import type { FullBookView } from "../../realtime/orderBook/bookStore";
import { simulateLocalSource, copySimulationInput, type ExecutionMetadata } from "../../submission/preflight/optimized/wsBook/executionSimulation";
import { observerClock } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";

let view: FullBookView, meta: ExecutionMetadata, lease: BookLease, allowed: boolean;
const input = { tokenId: "1", detectionOdds: 2, maxPrice: .5, apiBetMoney: 5, depth: { enabled: false, multiplier: 1.5 } };
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); allowed = true;
  view = { asset: "1", market: "m", status: "ready", generation: 1, assetGeneration: 1, snapshotEvidence: true, epoch: 1, revision: 1, sessionId: 1, streamEpoch: 1,
    receivedClockAt: observerClock(), snapshotClockAt: observerClock(), sourceAt: Date.now(),
    asks: [{ price: "0.5", size: "100" }], bids: [], viewTruncated: false };
  meta = { asset: "1", market: "m", version: 2, tick: "0.01", minSize: 1, negRisk: false, at: performance.now(), clockAt: observerClock(), bookGeneration: 1, assetGeneration: 1 };
  lease = { readFullBook: vi.fn(async () => view), isCurrent: vi.fn(() => true), readDepth: vi.fn(), setInterests: vi.fn(), onChange: vi.fn(), release: vi.fn() };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
test("complete local validation produces diagnostic quote only", async () => {
  const result = await simulateLocalSource(input, lease, meta, () => allowed);
  expect(result.report).toMatchObject({ decision: "local_candidate", executionSource: "existing-http", quote: { price: .5, limitPrice: .5, shares: 10, depthNeedUsdc: 5 } });
  expect(view.asks).toEqual([{ price: "0.5", size: "100" }]);
});
test.each([
  ["stale_book", (v: FullBookView) => { v.receivedClockAt! -= 1001; }],
  ["stale_book", (v: FullBookView) => { v.snapshotClockAt! -= 60001; }],
  ["source_clock_or_age", (v: FullBookView) => { v.sourceAt! -= 5001; }],
  ["source_clock_or_age", (v: FullBookView) => { v.sourceAt! += 1001; }],
  ["identity_or_metadata_changed", (v: FullBookView) => { v.asset = "2"; }],
  ["identity_or_metadata_changed", (v: FullBookView) => { v.generation++; }],
  ["identity_or_metadata_changed", (v: FullBookView) => { v.viewTruncated = true; }],
  ["local_rejected_or_error", (v: FullBookView) => { v.asks = []; }],
  ["local_rejected_or_error", (v: FullBookView) => { v.asks![0]!.size = "1"; }],
  ["depth_invalid", (v: FullBookView) => { v.asks![0]!.size = "NaN"; }],
] as const)("%s falls back without modifying original HTTP or waiting for another book", async (reason, mutate) => {
  mutate(view); const result = await simulateLocalSource(input, lease, meta, () => allowed);
  expect(result.report).toMatchObject({ decision: "http_fallback", reason });
  expect(lease.readFullBook).toHaveBeenCalledOnce();
});
test("unknown metadata and unsupported tick skip the read entirely", async () => {
  expect((await simulateLocalSource(input, lease, undefined, () => true)).report.reason).toBe("metadata_unknown");
  expect((await simulateLocalSource(input, lease, meta, () => true, true)).report.reason).toBe("tick_quote_excluded");
  expect(lease.readFullBook).not.toHaveBeenCalled();
});
test("stale/invalid metadata and changed source cannot produce a candidate", async () => {
  meta.clockAt -= 60001; expect((await simulateLocalSource(input, lease, meta, () => true)).report.reason).toBe("metadata_stale");
  meta.clockAt = observerClock(); meta.minSize = 0;
  expect((await simulateLocalSource(input, lease, meta, () => true)).report.reason).toBe("metadata_invalid");
  vi.mocked(lease.isCurrent).mockReturnValue(false);
  expect((await simulateLocalSource(input, lease, meta, () => true)).report.reason).toBe("scope_or_stream_changed");
});
test("wall-clock elapsed budget, cancellation, and thrown read always fail closed locally", async () => {
  vi.mocked(lease.readFullBook).mockImplementation(async () => { vi.setSystemTime(Date.now() + 21); return view; });
  expect((await simulateLocalSource(input, lease, meta, () => true)).report.reason).toBe("read_timeout");
  vi.mocked(lease.readFullBook).mockImplementation(async () => { allowed = false; return view; });
  expect((await simulateLocalSource(input, lease, meta, () => allowed)).report.decision).toBe("canceled");
  vi.mocked(lease.readFullBook).mockRejectedValue(Error("worker"));
  expect((await simulateLocalSource(input, lease, meta, () => true)).report.decision).toBe("http_fallback");
});
test("input is bounded and freezes scalars without retaining arbitrary caller fields", () => {
  const raw = { ...input, secret: "not retained", depth: { ...input.depth } }; const copy = copySimulationInput(raw)!;
  raw.depth.multiplier = 10; expect(copy.depth.multiplier).toBe(1.5); expect(Object.isFrozen(copy.depth)).toBe(true);
  expect("secret" in copy).toBe(false); expect(copySimulationInput({ ...input, apiBetMoney: NaN })).toBeUndefined();
});


test.each([false, undefined])("missing snapshot hash evidence %s cannot become an executable candidate", async evidence => {
  view.snapshotEvidence = evidence;
  expect((await simulateLocalSource(input,lease,meta,()=>true)).report).toMatchObject({decision:"http_fallback",reason:"snapshot_evidence_missing"});
});

test("metadata from before the target asset reset cannot validate its recovered book", async () => {
  view.assetGeneration = 2;
  expect((await simulateLocalSource(input,lease,meta,()=>true)).report.reason).toBe("identity_or_metadata_changed");
});
