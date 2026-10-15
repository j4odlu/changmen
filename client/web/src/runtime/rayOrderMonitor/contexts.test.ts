import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { bindRayOrderContexts, observeRayOrderContexts, registerRayOrderContext } from "./contexts";
import { useRayOrderContextStore } from "./contextStore";
const mocks = vi.hoisted(() => ({ user: "u1", logs: vi.fn().mockResolvedValue(true) }));
vi.mock("@/api/chat", () => ({ saveUserLog: mocks.logs }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.user, extensionPrefs: { rayLateRejectAutoMakeup: { enabled: false } } }) }));
const order = (status: VenueOrder["status"] = "none") => ({ provider: "RAY", orderId: "one", createAt: 10_000, odds: 2, betMoney: 70,
  match: "Alpha vs Beta", bet: "map1", item: "Beta", reward: 0, money: 0, game: "CS2", status }) as VenueOrder;
function input() { return { linkId: 100, matchId: 1, betId: 10, side: "B" as const, accountId: 2, submittedAt: 10_000,
  match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away" as const, odds: 2, betMoney: 70,
  anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 1, anchorBetMoney: 70, anchorOdds: 2,
  initialOrders: [order()], initialRejected: false }; }
beforeEach(() => { setActivePinia(createPinia()); sessionStorage.clear(); vi.clearAllMocks(); mocks.user = "u1"; });
it("registration hands over context synchronously without querying or repeating initial rejection handling", () => {
  registerRayOrderContext({ ...input(), initialRejected: true }); expect(useRayOrderContextStore().tasks.size).toBe(0);
  registerRayOrderContext(input()); registerRayOrderContext(input()); expect(useRayOrderContextStore().tasks.size).toBe(1);
});
it("consumes supplied facts and closes the original exactly once after a reject", async () => {
  registerRayOrderContext(input());
  bindRayOrderContexts({ accountId: 2 } as never, [order()], () => true);
  observeRayOrderContexts(2, [order("reject")], () => true); observeRayOrderContexts(2, [order("reject")], () => true);
  expect(useRayOrderContextStore().taskForLink(100)).toMatchObject({ status: "rejected", autoMakeupStatus: "disabled", monitorBound: true });
  expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
  expect(mocks.logs.mock.calls.filter(call => call[1].monitorEvent === "rejected")).toHaveLength(1);
});
it("ambiguous candidates remain unbound and cannot enter makeup", async () => {
  registerRayOrderContext({ ...input(), initialOrders: [] });
  bindRayOrderContexts({ accountId: 2 } as never, [order(), { ...order(), orderId: "two" }], () => true);
  observeRayOrderContexts(2, [order("reject")], () => true);
  expect(useRayOrderContextStore().taskForLink(100)).toMatchObject({ status: "ambiguous", candidateCount: 2 });
});
it("reject events require a uniquely identified original, independent of database synchronization", () => {
  registerRayOrderContext({ ...input(), initialOrders: [] });
  observeRayOrderContexts(2, [order("reject")], () => true); expect(useRayOrderContextStore().taskForLink(100)?.status).toBe("binding");
  bindRayOrderContexts({ accountId: 2 } as never, [order("reject")], () => true);
  observeRayOrderContexts(2, [order("reject")], () => true); expect(useRayOrderContextStore().taskForLink(100)?.status).toBe("rejected");
});
it("migrates expired legacy time limits into continuing contexts and removes the old storage key", () => {
  const legacy = { ...input(), key: "u1:100:B:2", userId: "u1", status: "watching", boundOrderId: "one",
    candidateCount: 1, pollCount: 4, updatedAt: Date.now(), expiresAt: 1, monitorMinutes: 5, nextPollAt: 1 };
  sessionStorage.setItem("changmen:ray-reject-monitor:v1:u1", JSON.stringify([legacy]));
  const store = useRayOrderContextStore(); store.restore("u1");
  expect(store.activeTasks).toHaveLength(1); expect(store.tasks.get(legacy.key)).not.toHaveProperty("expiresAt");
  expect(sessionStorage.getItem("changmen:ray-reject-monitor:v1:u1")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("changmen:ray-order-context:v1:u1")!)).toHaveLength(1);
});
