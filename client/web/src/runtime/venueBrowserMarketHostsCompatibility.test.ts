import { expect, it, vi } from "vitest";
import { watchSyncEffect } from "vue";

it("shares outcome identity, official result and reactive notifications across entries", async () => {
 const old = await import("@changmen/venue-browser/adapter/polymarket/pmMapOutcomeStore");
 const canonical = await import("@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore");
 const identity = await import("@changmen/venue-browser/polymarket/markets/pmMapIdentityStore");
 canonical.replacePmMapOutcomesFromIndex(null);
 const initial = old.pmMapOutcomeTick.value, notifications: number[] = [];
 const stop = watchSyncEffect(() => { notifications.push(old.pmMapOutcomeTick.value); });
 try {
  canonical.replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["h", "a"], entries: [{
   sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1, homeTokenId: "h", awayTokenId: "a",
   homeName: "Home", awayName: "Away", homeOdds: 0, awayOdds: 0, status: "Locked",
   mapOutcome: "home", outcomeKind: "official",
  }] });
  expect(old.pmMapOutcomeTick).toBe(canonical.pmMapOutcomeTick);
  expect(notifications).toEqual([initial, initial + 1]);
  expect(old.lookupPmMapOutcomeByToken("a")?.winningTokenId).toBe("h");
  expect(old.lookupPmMapIdentityByToken("h")).toBe(identity.lookupPmMapIdentityByToken("a"));
  old.replacePmMapOutcomesFromIndex(null);
  expect(canonical.lookupPmMapOutcomeByToken("a")).toBeNull();
  expect(identity.lookupPmMapIdentityByToken("h")).toBeNull();
  expect(notifications).toEqual([initial, initial + 1, initial + 2]);
 } finally { stop(); canonical.replacePmMapOutcomesFromIndex(null); }
});

it("keeps Worker creation behind the original permission callback and retains cleanup", async () => {
 const constructed = vi.fn(), terminate = vi.fn();
 class TestWorker {
  onmessage = null; onerror = null; onmessageerror = null;
  postMessage = vi.fn(); terminate = terminate;
  constructor(url: URL, options: WorkerOptions) { constructed(url, options); }
 }
 vi.stubGlobal("Worker", TestWorker);
 let active: import("@changmen/venue-browser/polymarket/orderBook").PmOrderBookService | undefined;
 try {
  const old = await import("@changmen/venue-browser/adapter/polymarket/orderBook");
  const canonical = await import("@changmen/venue-browser/polymarket/orderBook");
  expect(constructed).not.toHaveBeenCalled();
  const denied = old.createPmOrderBookService(() => false);
  expect(constructed).not.toHaveBeenCalled(); denied.stop();
  active = canonical.createPmOrderBookService(() => true);
  expect(active).toBeInstanceOf(old.PmOrderBookService);
  expect(constructed).toHaveBeenCalledOnce();
  expect(constructed.mock.calls[0]?.[0].pathname).toMatch(/\/client\/packages\/venue-browser\/pm-book-diagnostics\/marketData\.worker\.ts$/);
  expect(constructed.mock.calls[0]?.[1]).toEqual({ type: "module", name: "pm-market-book" });
  active.stop(); expect(terminate).toHaveBeenCalledOnce();
 } finally { active?.stop(); vi.unstubAllGlobals(); }
});
it("packages/venue-adapter/polymarket/markets/collect.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/collect"), import("@changmen/venue-browser/polymarket/markets/collect")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/marketIndex.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/marketIndex"), import("@changmen/venue-browser/polymarket/markets/marketIndex")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmFootballDiscovery.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmFootballDiscovery"), import("@changmen/venue-browser/polymarket/markets/pmFootballDiscovery")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmMapIdentityStore.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmMapIdentityStore"), import("@changmen/venue-browser/polymarket/markets/pmMapIdentityStore")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmMapOutcomeStore.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmMapOutcomeStore"), import("@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/collectNotify.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/collectNotify"), import("@changmen/venue-browser/shared/collectNotify")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/realtime/orderBook/service.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/realtime/orderBook/service"), import("@changmen/venue-browser/polymarket/realtime/orderBook/service")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orderBook.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orderBook"), import("@changmen/venue-browser/polymarket/orderBook")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/browser/pm-book-source-host.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/browser/pm-book-source-host"), import("@changmen/venue-browser/pm-book-source-host")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
