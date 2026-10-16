// [changmen 扩展] 显式启用的只读实测；真实 FOK 判断 + Node 公开 GET，非浏览器/VPS 全链路延迟。
import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { checkFokBuy } from "../../fok/preflight";
import { setPmFokPreflightMode } from "../../submission/preflight/pmFokPreflightMode";
import { clearPmGammaCacheForTests, fetchGammaEventById, fetchGammaMarketByTokenId } from "../../pmSportGamma";
import { clearPmExecutionMetrics, getPmExecutionMetrics } from "../../pmExecutionMetrics";
import { runPmBuyPreflight as beforePreflight } from "./fixtures/pmBeforeFastPreflight";

const io = vi.hoisted(() => ({ before: false, get: vi.fn(), forbidden: vi.fn(() => { throw new Error("Live probe must never sign or submit"); }) }));
vi.mock("../../submission/preflight/pmBuyPreflight", async importOriginal => {
  const original = await importOriginal<typeof import("../../submission/preflight/pmBuyPreflight")>();
  return { ...original, runPmBuyPreflight: (...args: Parameters<typeof original.runPmBuyPreflight>) =>
    io.before ? beforePreflight(...args) : original.runPmBuyPreflight(...args) };
});
vi.mock("../../transport", () => ({ polymarketPluginGet: io.get, polymarketPluginPost: io.forbidden }));
vi.mock("../../pmClientApi", () => ({
  pmGetBook: (token: string) => io.get(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(token)}`),
  pmPrepareSubmit: io.forbidden, pmSubmitClockReady: () => false, pmSubmitOrder: io.forbidden,
}));
vi.mock("../../pmOrderClientCache", () => ({
  getPolymarketOrderClientRuntime: io.forbidden, polymarketSigningGeneration: () => 0,
}));
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  getVenueOddsEntry: () => undefined, saveVenueOdds: () => {},
}));

interface RequestSample { stage: string; ms: number; headersMs: number; bytes: number; status?: number; error?: string }
const rounded = (value: number) => Math.round(value * 10) / 10;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, min: sorted[0], median: sorted.length
    ? rounded(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2) : undefined, max: sorted.at(-1) };
};

test.skipIf(process.env.PM_PREFLIGHT_LIVE !== "1")("times a public market with the actual FOK precheck, without an executable account", async () => {
  const startedAt = new Date().toISOString();
  const eventId = process.env.PM_PROBE_EVENT_ID || "1165026";
  const marketId = process.env.PM_PROBE_MARKET_ID || "5504916";
  const rounds = Math.min(10, Math.max(1, Number(process.env.PM_PROBE_ROUNDS) || 6));
  let requests: RequestSample[] = [];
  io.get.mockImplementation(async (url: string) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || !["gamma-api.polymarket.com", "clob.polymarket.com"].includes(target.hostname))
      throw new Error("Only official public GET endpoints are allowed");
    const stage = target.pathname === "/book" ? "book" : target.pathname.startsWith("/events/") ? "gamma_event"
      : target.hostname.startsWith("clob") ? "clob_market" : "gamma_market";
    const at = performance.now();
    const sample: RequestSample = { stage, ms: 0, headersMs: 0, bytes: 0 };
    requests.push(sample);
    try {
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
      sample.headersMs = rounded(performance.now() - at); sample.status = response.status;
      const body = await response.text(); sample.bytes = Buffer.byteLength(body);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return JSON.parse(body);
    } catch (error) {
      sample.error = error instanceof Error ? error.message : String(error); throw error;
    } finally { sample.ms = rounded(performance.now() - at); }
  });
  const event = await io.get(`https://gamma-api.polymarket.com/events/${eventId}`);
  const market = event.markets.find((row: { id: string }) => String(row.id) === marketId);
  expect(market, "requested market must belong to the event").toBeTruthy();
  expect(event.ended, "choose an event that has not ended").not.toBe(true);
  expect(market.acceptingOrders).toBe(true);
  const tokenId = JSON.parse(market.clobTokenIds)[0];
  const initialBook = await io.get(`https://clob.polymarket.com/book?token_id=${tokenId}`);
  const ask = Math.min(...initialBook.asks.map((row: { price: string }) => Number(row.price)));
  const tick = Number(initialBook.tick_size);
  const limit = Math.min(1 - tick, Math.ceil((ask + 2 * tick) / tick - 1e-9) * tick);
  expect(limit).toBeGreaterThan(0); expect(limit).toBeLessThan(1);
  const amount = 10;
  const discoveryRequests = requests;
  const account = { provider: "Polymarket", accountId: 0, gateway: "https://clob.polymarket.com", currency: "USDT", token: "" } as unknown as PlatformAccount;
  const samples: Array<Record<string, unknown> & { scenario: string; totalMs: number; requests: RequestSample[] }> = [];
  try {
    setPmFokPreflightMode("optimized");
    for (let round = 0; round < rounds; round++) {
      const scenarios = process.env.PM_PROBE_COMPARE_FAST === "1"
        ? (round % 2 ? ["after_fast", "before_fast"] : ["before_fast", "after_fast"]) : ["cold_gamma", "warm_gamma"];
      for (const scenario of scenarios) {
        io.before = scenario === "before_fast";
        clearPmGammaCacheForTests();
        requests = [];
        const warmAt = performance.now();
        if (scenario === "warm_gamma") await Promise.all([fetchGammaEventById(eventId), fetchGammaMarketByTokenId(tokenId)]);
        const warmupMs = scenario === "warm_gamma" ? rounded(performance.now() - warmAt) : 0;
        const warmupRequests = requests;
        requests = []; clearPmExecutionMetrics();
        const option = { type: "Polymarket", itemId: tokenId, betId: market.conditionId, betMoney: amount,
          odds: 1 / limit, target: "latency-probe", bet: { round: 0 }, match: { providers: { Polymarket: eventId } } } as unknown as BetOption;
        const at = performance.now();
        const result = await checkFokBuy(account, option, { role: "precheckOnly", requireClobConfirmation: true });
        const sample = { scenario, round, totalMs: rounded(performance.now() - at), passed: Boolean(result.data) && !result.checkError,
          error: result.checkError, requests, warmupMs, warmupRequests: scenario === "warm_gamma" ? warmupRequests : [],
          metrics: getPmExecutionMetrics(), bookPrice: result.data?.bookPrice, limitPrice: result.data?.limitPrice };
        samples.push(sample);
        console.log(JSON.stringify({ scenario, round, ms: sample.totalMs, passed: sample.passed,
          error: sample.error, requests: requests.map(r => ({ stage: r.stage, ms: r.ms })) }));
      }
    }
    const summary = Object.fromEntries([...new Set(samples.map(row => row.scenario))].map(scenario => {
      const rows = samples.filter(r => r.scenario === scenario);
      return [scenario, { totalMs: stats(rows.map(r => r.totalMs)),
        stages: Object.fromEntries(["book", "clob_market", "gamma_market", "gamma_event"].map(stage => [stage,
          stats(rows.flatMap(r => r.requests.filter(q => q.stage === stage).map(q => q.ms)))])) }];
    }));
    const output = path.resolve(process.cwd(), "../../output/pm-preflight-latency", `${startedAt.replaceAll(":", "-")}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(),
      scope: "Real checkFokBuy, precheckOnly, official GET via Node; excludes browser/VPS/extension, wallet and submission clock. Warmup time is excluded from warm total and recorded separately.",
      route: process.env.PM_PROBE_ROUTE_LABEL || "Node direct",
      market: { eventId, marketId, title: market.question, slug: event.slug, tokenId, conditionId: market.conditionId },
      amount, limit, discoveryRequests, summary, samples }, null, 2));
    console.log(JSON.stringify({ output, summary }));
    expect(io.forbidden).not.toHaveBeenCalled();
    expect(samples).toHaveLength(rounds * 2);
  } finally { io.before = false; setPmFokPreflightMode("legacy"); clearPmGammaCacheForTests(); }
}, 240_000);
