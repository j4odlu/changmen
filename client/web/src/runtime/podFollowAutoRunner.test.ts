import { beforeEach, expect, it, vi } from "vitest";
import type { PodBetSettings } from "./podBetSettings";
import type { PodFollowExecutionTicket } from "./podFollowExecutionTypes";
import type { PodFollowLogRow } from "./podFollowLog";
import { createPodFollowAutoRunner, type PodFollowAutoRunnerContext } from "./podFollowAutoRunner";
import { createOriginalPodRunner } from "./__tests__/podFollowOriginal";

const mocks = vi.hoisted(() => ({
  choose: (rows: { id: string }[], skipped: Iterable<string>) => rows.find(row => !new Set(skipped).has(row.id)) ?? null,
  prefetch: vi.fn(),
  failReason: () => null,
  withinAge: () => true,
  placeBlock: () => null,
}));
vi.mock("./podYabo", () => ({ pickPodYaboAutoTicket: mocks.choose }));
vi.mock("./podRayFollowPlace", () => ({ pickPodRayAutoTicket: mocks.choose }));
vi.mock("./podPmFollowPlace", () => ({ pickPodPmAutoTicket: mocks.choose }));
vi.mock("./podBetSettings", () => ({ podAlertBetFailReason: mocks.failReason, podAlertWithinFollowAge: mocks.withinAge }));
vi.mock("./podFollowPlace", () => ({ podFollowPlaceBlock: mocks.placeBlock }));
vi.mock("./podMarketPrefetch", () => ({ prefetchObSportOidQuote: mocks.prefetch }));

const cell = <T>(value: T) => ({ value });
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(ids = ["one"]) {
  const trace: unknown[][] = [];
  const waits = new Map<string, Promise<void>>();
  const payload = (ticket: PodFollowExecutionTicket, auto = false) => ({
    id: ticket.id, stake: 50, auto, fixtureStatus: "matched", fixtureBasis: "confirmed" as const,
    obMid: `ob-${ticket.id}`, pmMatchId: `pm-${ticket.id}`, rayMatchId: `ray-${ticket.id}`,
    market: { status: "matched" as const, ob: true, oid: ticket.id, quote: 2, marketCode: "totals", boardSide: "over" as const,
      betId: "condition", locked: false, venue: "OB", boardLine: 2.5, fromLive: true },
    quote: { status: "ok" as const, quote: 2, minObOdds: 1.9, maxObOdds: 2.2, evPercent: 8 },
  });
  const autoAttempted = cell<Record<string, true>>({});
  const ticketSource = cell(ids.map(id => ({ id, alert: {} }) as PodFollowExecutionTicket));
  const pending = (venue: string) => Object.keys(autoAttempted.value).filter(key => key.startsWith(`${venue}:`)).map(key => key.slice(venue.length + 1));
  let active = 0, maxActive = 0;
  const place = (venue: string) => async (ticket: PodFollowExecutionTicket, auto = false) => {
    active++; maxActive = Math.max(maxActive, active);
    trace.push(["send", venue, ticket.id, auto]);
    await waits.get(venue);
    trace.push(["settle", venue, ticket.id]);
    active--;
  };
  const ctx: PodFollowAutoRunnerContext = {
    betSettings: cell({ enabled: true, autoPlace: true, maxAgeSec: 60 } as PodBetSettings),
    tickets: ticketSource,
    placingId: cell(""), placingPmId: cell(""), placingRayId: cell(""),
    followObEnabled: cell(true), followPmEnabled: cell(true), followRayEnabled: cell(true),
    rayOrdersRefreshing: cell(false), autoAttempted, autoReady: cell(true), placed: cell({}),
    logRows: cell([{ id: "restored", placed: true }] as PodFollowLogRow[]),
    sportOdds: { hasFresh: () => true },
    accountStore: { loaded: true, loadAccounts: async () => { trace.push(["accounts"]); ctx.accountStore.loaded = true; } },
    footballOrders: { loaded: true, load: async () => { trace.push(["football"]); ctx.footballOrders.loaded = true; } },
    orderStore: { fetchOrders: async (_date, opts) => { trace.push(["orders", opts]); return true; } },
    refreshLog: () => { trace.push(["log"]); },
    payloads: { ticketPlacePayload: payload, pmTicketPlacePayload: payload, rayTicketPlacePayload: payload },
    gates: {
      pendingPlacedIds: () => pending("OB"), pendingPlacedEntries: () => [],
      pendingCap: () => ({ todayProfit: 0, openStake: 0, maxDailyLoss: 100 }),
      venuePlaceKey: (venue, id) => `${venue}:${id}`, venueDailyOrderBlock: () => null,
      rayPendingPlacedIds: () => pending("RAY"), rayPendingPlacedEntries: () => [],
      pendingPmPlacedIds: () => pending("Polymarket"), pendingPmPlacedEntries: () => [],
    },
    placement: { placeTicket: place("OB"), placeRayTicket: place("RAY"), placePmTicket: place("Polymarket") },
  };
  return { ctx, trace, waits, ticketSource, maxActive: () => maxActive };
}
const originalDependencies = {
  pickPodYaboAutoTicket: mocks.choose, pickPodRayAutoTicket: mocks.choose, pickPodPmAutoTicket: mocks.choose,
  podAlertBetFailReason: mocks.failReason, podAlertWithinFollowAge: mocks.withinAge,
  podFollowPlaceBlock: mocks.placeBlock, prefetchObSportOidQuote: mocks.prefetch,
};
beforeEach(() => { mocks.prefetch.mockClear(); });

it("matches the original submission order, deduplication and busy/ready gates in 192 scenarios", async () => {
  let cases = 0;
  for (let flags = 0; flags < 64; flags++) for (const ids of [[], ["one"], ["one", "two", "three"]]) {
    const before = fixture(ids), after = fixture(ids);
    for (const f of [before, after]) {
      f.ctx.betSettings.value.enabled = !(flags & 1);
      f.ctx.betSettings.value.autoPlace = !(flags & 2);
      f.ctx.autoReady.value = !(flags & 4);
      f.ctx.followObEnabled = cell(!(flags & 8));
      f.ctx.followRayEnabled = cell(!(flags & 16));
      f.ctx.followPmEnabled = cell(!(flags & 32));
      f.ctx.placingId = cell(flags % 7 === 0 ? "busy" : "");
      f.ctx.rayOrdersRefreshing = cell(flags % 5 === 0);
    }
    const oldRunner = createOriginalPodRunner(before.ctx, originalDependencies);
    const runner = createPodFollowAutoRunner(after.ctx);
    oldRunner.start(); runner.start(); oldRunner.requestAutoPlace(); runner.requestAutoPlace();
    await flush();
    expect(after.trace).toEqual(before.trace);
    expect(after.ctx.autoAttempted.value).toEqual(before.ctx.autoAttempted.value);
    expect(after.maxActive()).toBeLessThanOrEqual(1);
    oldRunner.stop(); runner.stop(); cases++;
  }
  expect(cases).toBe(192);
});

it("coalesces wakeups while one submission is pending without resending an attempted ticket", async () => {
  const f = fixture(), wait = deferred(); f.waits.set("OB", wait.promise);
  const runner = createPodFollowAutoRunner(f.ctx); runner.start();
  runner.requestAutoPlace(); runner.requestAutoPlace(); runner.requestAutoPlace();
  await flush(); expect(f.trace).toEqual([["send", "OB", "one", true]]);
  wait.resolve(); await flush();
  expect(f.trace.filter(row => row[0] === "send").map(row => row[1])).toEqual(["OB", "RAY", "Polymarket"]);
  expect(f.maxActive()).toBe(1); runner.stop();
});

it("reproduces the original unmount bug and prevents any next-venue submission after stop", async () => {
  const before = fixture(), after = fixture(), oldWait = deferred(), wait = deferred();
  before.waits.set("OB", oldWait.promise); after.waits.set("OB", wait.promise);
  const oldRunner = createOriginalPodRunner(before.ctx, originalDependencies), runner = createPodFollowAutoRunner(after.ctx);
  oldRunner.start(); runner.start(); oldRunner.requestAutoPlace(); runner.requestAutoPlace(); await flush();
  oldRunner.stop(); runner.stop(); oldWait.resolve(); wait.resolve(); await flush();
  expect(before.trace.filter(row => row[0] === "send").map(row => row[1])).toEqual(["OB", "RAY", "Polymarket"]);
  expect(after.trace).toEqual([["send", "OB", "one", true], ["settle", "OB", "one"]]);
});

it("also stops between RAY and PM, while allowing the already submitted RAY order to finish", async () => {
  const f = fixture(), wait = deferred(); f.waits.set("RAY", wait.promise);
  const runner = createPodFollowAutoRunner(f.ctx); runner.start(); runner.requestAutoPlace(); await flush();
  runner.stop(); wait.resolve(); await flush();
  expect(f.trace.filter(row => row[0] === "send").map(row => row[1])).toEqual(["OB", "RAY"]);
  expect(f.trace.at(-1)).toEqual(["settle", "RAY", "one"]);
});

it("does not let an old generation continue its venue sequence after a restart", async () => {
  const f = fixture(["old"]), wait = deferred(); f.waits.set("OB", wait.promise);
  const runner = createPodFollowAutoRunner(f.ctx); runner.start(); runner.requestAutoPlace(); await flush();
  runner.stop(); runner.start(); f.ticketSource.value = [{ id: "new", alert: {} } as PodFollowExecutionTicket];
  runner.requestAutoPlace(); wait.resolve(); await flush();
  expect(f.trace.filter(row => row[0] === "send" && row[2] === "old").map(row => row[1])).toEqual(["OB"]);
  expect(f.trace.filter(row => row[0] === "send" && row[2] === "new").map(row => row[1])).toEqual(["OB", "RAY", "Polymarket"]);
  runner.stop();
});

it("does not turn completion of a stopped generation into a new wakeup after restart", async () => {
  const f = fixture(["old"]), wait = deferred(); f.waits.set("OB", wait.promise);
  const runner = createPodFollowAutoRunner(f.ctx); runner.start(); runner.requestAutoPlace(); await flush();
  runner.stop(); runner.start(); f.ticketSource.value = [{ id: "new", alert: {} } as PodFollowExecutionTicket];
  wait.resolve(); await flush();
  expect(f.trace).toEqual([["send", "OB", "old", true], ["settle", "OB", "old"]]);
  runner.stop();
});

it("preserves successful restoration and pauses automatically when order restoration fails", async () => {
  for (const success of [true, false]) {
    const before = fixture([]), after = fixture([]);
    for (const f of [before, after]) {
      f.ctx.autoReady.value = false; f.ctx.accountStore.loaded = false; f.ctx.footballOrders.loaded = false;
      f.ctx.orderStore.fetchOrders = async (_date, opts) => { f.trace.push(["orders", opts]); return success; };
    }
    const oldRunner = createOriginalPodRunner(before.ctx, originalDependencies), runner = createPodFollowAutoRunner(after.ctx);
    oldRunner.start(); runner.start();
    await Promise.all([oldRunner.restoreAutoPlaceState(), runner.restoreAutoPlaceState()]); await flush();
    expect(after.trace).toEqual(before.trace); expect(after.ctx.autoReady.value).toBe(success);
    expect(after.ctx.placed.value).toEqual(before.ctx.placed.value); oldRunner.stop(); runner.stop();
  }
});

it("does not revive readiness or start further restore reads after an unmount", async () => {
  const f = fixture(), wait = deferred(); f.ctx.accountStore.loaded = false;
  f.ctx.accountStore.loadAccounts = async () => { await wait.promise; f.ctx.accountStore.loaded = true; };
  const runner = createPodFollowAutoRunner(f.ctx); runner.start();
  const restoring = runner.restoreAutoPlaceState(); runner.stop(); wait.resolve(); await restoring; await flush();
  expect(f.ctx.autoReady.value).toBe(false); expect(f.trace).toEqual([]);
});
