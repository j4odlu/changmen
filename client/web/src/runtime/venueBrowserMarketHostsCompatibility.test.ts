import { expect, it, vi } from "vitest";
import { watchSyncEffect } from "vue";

it("updates outcome identity, official results and reactive notifications together", async () => {
 const outcomes = await import("@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore");
 const identity = await import("@changmen/venue-browser/polymarket/markets/pmMapIdentityStore");
 outcomes.replacePmMapOutcomesFromIndex(null);
 const initial = outcomes.pmMapOutcomeTick.value, notifications: number[] = [];
 const stop = watchSyncEffect(() => { notifications.push(outcomes.pmMapOutcomeTick.value); });
 try {
  outcomes.replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["h", "a"], entries: [{
   sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1, homeTokenId: "h", awayTokenId: "a",
   homeName: "Home", awayName: "Away", homeOdds: 0, awayOdds: 0, status: "Locked",
   mapOutcome: "home", outcomeKind: "official",
  }] });
  expect(notifications).toEqual([initial, initial + 1]);
  expect(outcomes.lookupPmMapOutcomeByToken("a")?.winningTokenId).toBe("h");
  expect(outcomes.lookupPmMapIdentityByToken("h")).toBe(identity.lookupPmMapIdentityByToken("a"));
  outcomes.replacePmMapOutcomesFromIndex(null);
  expect(outcomes.lookupPmMapOutcomeByToken("a")).toBeNull();
  expect(identity.lookupPmMapIdentityByToken("h")).toBeNull();
  expect(notifications).toEqual([initial, initial + 1, initial + 2]);
 } finally { stop(); outcomes.replacePmMapOutcomesFromIndex(null); }
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
  const orderBook = await import("@changmen/venue-browser/polymarket/orderBook");
  expect(constructed).not.toHaveBeenCalled();
  const denied = orderBook.createPmOrderBookService(() => false);
  expect(constructed).not.toHaveBeenCalled(); denied.stop();
  active = orderBook.createPmOrderBookService(() => true);
  expect(active).toBeInstanceOf(orderBook.PmOrderBookService);
  expect(constructed).toHaveBeenCalledOnce();
  expect(constructed.mock.calls[0]?.[0].pathname).toMatch(/\/client\/packages\/venue-browser\/pm-book-diagnostics\/marketData\.worker\.ts$/);
  expect(constructed.mock.calls[0]?.[1]).toEqual({ type: "module", name: "pm-market-book" });
  active.stop(); expect(terminate).toHaveBeenCalledOnce();
 } finally { active?.stop(); vi.unstubAllGlobals(); }
});
it("packages/venue-adapter/shared/collectNotify.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/collectNotify"), import("@changmen/venue-browser/shared/collectNotify")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/browser/pm-book-source-host.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/browser/pm-book-source-host"), import("@changmen/venue-browser/pm-book-source-host")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
