import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { createLocalGtc, listLocalGtc, mutateLocalGtc } from "@/orderModes/gtc/localStore";
import { rememberGtcOrderIdentity, resetGtcOrderProjection, tagKnownGtcVenueOrders } from "@/orderModes/gtc/executionProjection";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import { readGtcOtherOrders } from "@/orderModes/gtc/otherOrders";
import { beginRayOrderObservation, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { syncVenueOrders } from "./venueOrders";
import { flushGtcResults, startGtcOrderSync, stopGtcOrderSync } from "./gtcOrderSync";

const mock = vi.hoisted(() => ({ post: vi.fn(), getOrders: vi.fn(), session: 1 }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => mock.session,
  isAuthSessionCurrent: (version: number) => version === mock.session,
  unwrap: (response: { success: number; info: unknown }) => { if (response.success !== 1) throw new Error("save failed"); return response.info; } }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", isLoggedIn: true }) }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mock.getOrders }) }));
vi.mock("./rayOrderBindings", () => ({ syncRayOrderBindings: async () => {} }));
const id = "11111111-1111-4111-8111-111111111111";
const link = 1791558222471;
function order(provider: VenueOrder["provider"] = "RAY", orderId = "other-original"): VenueOrder {
  return { provider, orderId, createAt: Date.now(), odds: 2, betMoney: 100, money: 0, reward: 0,
    status: "none", match: "m", bet: "b", item: "i", game: "" };
}
async function execution(provider: string) {
  const plan = { playerId: 1, otherPlayerId: 2, otherProvider: provider, originalPmLeg: "B", parallel: false,
    orderHash: `0x${"a".repeat(64)}`, shares: "10", linkId: link } as GtcPlan;
  let row = await createLocalGtc("owner", id, "maker", plan);
  row = await mutateLocalGtc("owner", id, row.revision, { kind: "authorize_other" });
  return mutateLocalGtc("owner", id, row.revision, { kind: "other", state: "accepted", orderId: "other-original" });
}
beforeEach(() => {
  stopGtcOrderSync(); resetGtcOrderProjection(); resetRayOrderResults(); vi.clearAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory()); mock.session = 1; gtcProgress.saveIssues = {};
  mock.post.mockResolvedValue({ success: 1, info: true }); mock.getOrders.mockResolvedValue([]);
});
afterEach(stopGtcOrderSync);
it.each(["RAY", "IM"] as const)("normal %s synchronization saves late monitor-confirmed attribution and the latest outcome once", async provider => {
  let row = await execution(provider); rememberGtcOrderIdentity(row);
  const account = new PlatformAccount({ accountId: 2, provider, playerName: "other" });
  if (provider === "RAY") beginRayOrderObservation(account)([]);
  expect(await readGtcOtherOrders(account, row)).toEqual([]);
  const original = order(provider);
  mock.getOrders.mockResolvedValue([original]);
  if (provider === "RAY") beginRayOrderObservation(account)([original]);
  expect(await readGtcOtherOrders(account, row)).toMatchObject([{ link, pmGtcExecutionId: id }]);
  expect(mock.post).not.toHaveBeenCalled();
  row = await mutateLocalGtc("owner", id, row.revision, { kind: "other", state: "filled", orderId: original.orderId });
  rememberGtcOrderIdentity(row);
  // 监控之后又出现拒单；同步必须保存最新查询，不回写监控旧快照。
  const latest = { ...original, status: "reject", money: -100 };
  const fok = order(provider, "unrelated-fok");
  mock.getOrders.mockResolvedValue([latest, fok]);
  startGtcOrderSync("owner"); await flushGtcResults();
  await syncVenueOrders(account);
  const dedicated = mock.post.mock.calls.filter(call => call[0] === "Pm_GtcSaveOrders");
  expect(dedicated).toHaveLength(1);
  expect(JSON.parse(dedicated[0]![1].orders)).toEqual([{ ...latest, link, pmGtcExecutionId: id }]);
  expect(dedicated[0]![1].origins).toEqual([{ executionId: id, playerId: 2, provider, orderId: latest.orderId }]);
  const ordinary = mock.post.mock.calls.filter(call => call[0] === "Client_SaveOrder");
  expect(ordinary).toHaveLength(1); expect(JSON.parse(ordinary[0]![1].orders)).toEqual([fok]);
  expect(latest).not.toHaveProperty("pmGtcExecutionId"); expect(latest).not.toHaveProperty("link");
});
it("restores exact counterpart identity from durable client records after a refresh", async () => {
  await execution("IM"); resetGtcOrderProjection();
  startGtcOrderSync("owner"); await flushGtcResults();
  await vi.waitFor(() => expect(tagKnownGtcVenueOrders(2, [order("IM")])).toMatchObject([{ pmGtcExecutionId: id }]));
  mock.getOrders.mockResolvedValue([order("IM")]);
  await syncVenueOrders(new PlatformAccount({ accountId: 2, provider: "IM", playerName: "other" }));
  expect(mock.post.mock.calls.map(call => call[0])).toEqual(["Pm_GtcSaveOrders"]);
  expect((await listLocalGtc("owner"))[0]!.other.orderId).toBe("other-original");
});
it.each(["error", "false"])("failed %s acknowledgement retries next normal sync without blocking unrelated FOK orders", async failure => {
  rememberGtcOrderIdentity(await execution("IM"));
  let attempts = 0;
  mock.post.mockImplementation(async action => {
    if (action === "Pm_GtcSaveOrders" && ++attempts === 1) {
      if (failure === "error") throw new Error("RDS offline");
      return { success: 1, info: false };
    }
    return { success: 1, info: true };
  });
  const original = order("IM"), fok = order("IM", "fok");
  mock.getOrders.mockResolvedValue([original, fok]);
  const account = new PlatformAccount({ accountId: 2, provider: "IM", playerName: "other" });
  startGtcOrderSync("owner"); await flushGtcResults();
  await syncVenueOrders(account);
  expect(gtcProgress.saveIssues[id]).toBeDefined();
  expect(JSON.parse(mock.post.mock.calls.find(call => call[0] === "Client_SaveOrder")![1].orders)).toEqual([original, fok]);
  await syncVenueOrders(account);
  expect(attempts).toBe(2); expect(gtcProgress.saveIssues[id]).toBeUndefined();
  expect(JSON.parse(mock.post.mock.calls.filter(call => call[0] === "Client_SaveOrder").at(-1)![1].orders)).toEqual([fok]);
});
it("a late save response from the previous login cannot continue ordinary saving", async () => {
  rememberGtcOrderIdentity(await execution("IM"));
  mock.post.mockImplementation(async () => { mock.session++; return { success: 1, info: true }; });
  mock.getOrders.mockResolvedValue([order("IM"), order("IM", "fok")]);
  startGtcOrderSync("owner"); await flushGtcResults();
  await expect(syncVenueOrders(new PlatformAccount({ accountId: 2, provider: "IM", playerName: "other" }))).rejects.toThrow("会话已变更");
  expect(mock.post.mock.calls.map(call => call[0])).toEqual(["Pm_GtcSaveOrders"]);
});
it("an optimistic identity that has not persisted cannot claim an unrelated order", async () => {
  const row = await execution("IM"); rememberGtcOrderIdentity({ ...row, other: { ...row.other, orderId: "fok" } });
  const fok = order("IM", "fok"); mock.getOrders.mockResolvedValue([fok]);
  startGtcOrderSync("owner"); await flushGtcResults();
  await syncVenueOrders(new PlatformAccount({ accountId: 2, provider: "IM", playerName: "other" }));
  expect(mock.post.mock.calls.map(call => call[0])).toEqual(["Client_SaveOrder"]);
  expect(JSON.parse(mock.post.mock.calls[0]![1].orders)).toEqual([fok]);
});
it("ordinary FOK synchronization has no dependency on GTC client storage", async () => {
  startGtcOrderSync("owner"); await flushGtcResults();
  vi.stubGlobal("indexedDB", undefined);
  const fok = order("IM", "fok"); mock.getOrders.mockResolvedValue([fok]);
  await syncVenueOrders(new PlatformAccount({ accountId: 2, provider: "IM", playerName: "other" }));
  expect(mock.post.mock.calls.map(call => call[0])).toEqual(["Client_SaveOrder"]);
  expect(JSON.parse(mock.post.mock.calls[0]![1].orders)).toEqual([fok]);
});
