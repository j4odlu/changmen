import { bookAgeFailure, withinAge, DYNAMIC_BOOK_AGES } from "./freshnessPolicy";
import type { FullBookView } from "../../../../realtime/orderBook/bookStore";
import type { BookLease } from "../../../../realtime/orderBook/service";
import type { BookMetadata } from "./bookMetadata";
import type { PolymarketOrderOptions } from "../../../../fok/preflight";
import { simulateExecutableBuy, type SimulationInput } from "./executionMath";
import { observerClock } from "./shadowWorkerProtocol";
import { currentPmTick } from "../../../../pmTickState";
import { normalizePolymarketTickSize } from "../../../../pmTickPrice";

export interface ExecutionMetadata extends BookMetadata { asset: string; bookGeneration: number; assetGeneration: number; clockAt: number }
export interface ExecutionSimulation {
  mode: "simulation"; executionSource: "existing-http";
  decision: "local_candidate" | "http_fallback" | "canceled";
  reason: string; totalMs: number; sourceAt?: number; revision?: number;
  quote?: ReturnType<typeof simulateExecutableBuy>;
}
export interface SimulationObservation { report: ExecutionSimulation; view?: FullBookView; options?: PolymarketOrderOptions }
/** Selects a hypothetical source only. No HTTP callback, signer or order API is accepted. */
export async function simulateLocalSource(input: SimulationInput, lease: BookLease,
  metadata: ExecutionMetadata | undefined, allowed: () => boolean, tick = false): Promise<SimulationObservation> {
  const at = observerClock();
  const result = (decision: ExecutionSimulation["decision"], reason: string, rest: Partial<SimulationObservation> = {}): SimulationObservation => ({
    ...rest, report: { ...rest.report, mode: "simulation", executionSource: "existing-http", decision, reason, totalMs: Math.max(0, observerClock() - at) },
  });
  if (!allowed()) return result("canceled", "scope_stopped");
  if (tick) return result("http_fallback", "tick_quote_excluded");
  if (!metadata) return result("http_fallback", "metadata_unknown");
  try {
    const view = await lease.readFullBook(input.tokenId);
    if (!allowed()) return result("canceled", "scope_stopped");
    if (observerClock() - at > 20) return result("http_fallback", "read_timeout");
    if (view.status !== "ready") return result("http_fallback", view.status);
    if (!lease.isCurrent(view)) return result("http_fallback", "scope_or_stream_changed");
    const now = observerClock(), wall = Date.now();
    if (view.asset !== input.tokenId || view.market !== metadata.market || metadata.asset !== input.tokenId
      || view.generation !== metadata.bookGeneration || view.assetGeneration !== metadata.assetGeneration || !Number.isSafeInteger(view.assetGeneration) || view.assetGeneration! <= 0 || view.viewTruncated !== false || !view.asks || !view.bids)
      return result("http_fallback", "identity_or_metadata_changed");
    const ageFailure = bookAgeFailure(view, now, wall);
    if (ageFailure) return result("http_fallback", ageFailure);
    if (!withinAge(metadata.clockAt, now, DYNAMIC_BOOK_AGES.metadata)) return result("http_fallback", "metadata_stale");
    if (view.snapshotEvidence !== true) return result("http_fallback", "snapshot_evidence_missing");
    const tickSize = normalizePolymarketTickSize(metadata.tick);
    const latestTick = currentPmTick(input.tokenId, view.sourceAt!);
    if (latestTick && latestTick !== tickSize) return result("http_fallback", "tick_changed");
    if (![2, 3].includes(metadata.version) || !Number.isFinite(metadata.minSize) || metadata.minSize <= 0 || typeof metadata.negRisk !== "boolean")
      return result("http_fallback", "metadata_invalid");
    const asks = view.asks.map(row => ({ price: Number(row.price), size: Number(row.size) }));
    if (asks.some(row => !Number.isFinite(row.price) || row.price <= 0 || row.price >= 1 || !Number.isFinite(row.size) || row.size <= 0))
      return result("http_fallback", "depth_invalid");
    const options: PolymarketOrderOptions = { version: metadata.version, tickSize, minOrderSize: metadata.minSize,
      negRisk: metadata.negRisk, bookTimestamp: view.sourceAt!, asks };
    const quote = simulateExecutableBuy(input, options);
    if (!allowed()) return result("canceled", "scope_stopped");
    if (observerClock() - at > 20) return result("http_fallback", "calculation_timeout");
    if (!lease.isCurrent(view)) return result("http_fallback", "scope_or_stream_changed");
    return result("local_candidate", "validated", { view, options,
      report: { mode: "simulation", executionSource: "existing-http", decision: "local_candidate", reason: "validated", totalMs: 0,
        sourceAt: view.sourceAt, revision: view.revision, quote } });
  } catch { return result("http_fallback", "local_rejected_or_error"); }
}

export function copySimulationInput(raw: SimulationInput | undefined): SimulationInput | undefined {
  if (!raw || !/^\d{1,256}$/.test(raw.tokenId) || ![raw.apiBetMoney, raw.detectionOdds, raw.maxPrice, raw.depth?.multiplier].every(Number.isFinite)
    || raw.apiBetMoney <= 0 || raw.detectionOdds <= 1 || raw.maxPrice <= 0 || raw.maxPrice >= 1
    || typeof raw.depth?.enabled !== "boolean" || raw.depth.multiplier < 1.1 || raw.depth.multiplier > 10) return;
  return Object.freeze({ tokenId: raw.tokenId, apiBetMoney: raw.apiBetMoney, detectionOdds: raw.detectionOdds, maxPrice: raw.maxPrice,
    depth: Object.freeze({ enabled: raw.depth.enabled, multiplier: raw.depth.multiplier }) });
}
