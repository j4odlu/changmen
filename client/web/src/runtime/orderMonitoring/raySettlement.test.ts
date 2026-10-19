import type { VenueOrder } from "@changmen/client-core/contract";
import type { OrderRow } from "@/types/order";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { PlatformAccount } from "@/models/platformAccount";
import { pollRaySettlement, recoverRaySettlement, stopRayOrderMonitoring } from "@/runtime/rayOrderMonitor/runtime";
import { rayMonitoring, resetRayMonitoring } from "./rayState";

const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), save: vi.fn(), refresh: vi.fn(), profit: vi.fn(), owner: "owner", valid: true,
  preview: false, rows: new Map<number, OrderRow[]>(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.owner, isAuthSessionCurrent: (owner: string) => mocks.valid && owner === mocks.owner }));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save }));
vi.mock("@/runtime/rayOrderMonitor/api", () => ({ loadRayMonitorOrders: mocks.load, saveRayMonitorOrders: mocks.save }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.owner }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mocks.rows, orderDate: "2026-10-10", fetchOrders: mocks.refresh, updateTodayProfit: mocks.profit }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mocks.accounts, adminWorkspacePreview: mocks.preview,
  findAccount: (id: number) => mocks.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/runtime/orderPolling/ray", () => ({ readRayAccountOrders: mocks.read, resetRayOrderPolling: vi.fn() }));
const known = (id: string): OrderRow => ({ OrderID: id, PlayerID: 2, Type: "RAY", Status: "None" });
const venue = (id: string, status: VenueOrder["status"]) => ({ provider: "RAY", orderId: id, status }) as VenueOrder;
async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
async function nextPoll() { vi.advanceTimersByTime(5000); pollRaySettlement(); await flush(); }
beforeEach(() => {
  setActivePinia(createPinia());
  stopRayOrderMonitoring(); resetRayMonitoring(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(100_000);
  sessionStorage.clear(); mocks.rows.clear(); mocks.owner = "owner"; mocks.valid = true; mocks.preview = false;
  mocks.accounts = [new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" })];
  mocks.load.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined); mocks.refresh.mockResolvedValue(true);
});
afterEach(() => {
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  stopRayOrderMonitoring(); vi.useRealTimers();
});

it("ordinary and persisted GTC originals share one account query and unrelated orders are never saved", async () => {
  mocks.rows.set(1, [known("one"), known("two"), { ...known("gtc"), PmGtcExecutionId: "execution" }]);
  mocks.read.mockResolvedValue([venue("one", "win"), venue("two", "lose"), venue("gtc", "lose"), venue("unrelated", "win")]);
  pollRaySettlement(); await flush(); await nextPoll();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.rows.get(1)?.map(row => row.Status)).toEqual(["Win", "Lose", "Lose"]);
  expect(mocks.rows.get(1)?.[2]?.PmGtcExecutionId).toBe("execution");
});
it("recovers older pending originals from the database without opening the sidebar or having session storage", async () => {
  mocks.load.mockResolvedValue([{ ...known("old"), CreateAt: 1 }]); mocks.read.mockResolvedValue([venue("old", "lose")]);
  pollRaySettlement(); await flush();
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(2, []);
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(rayMonitoring.orders.get("2:old")).toMatchObject({ phase: "closed", status: "lose" });
});
it("refresh restores a pending original after the sidebar has switched dates", async () => {
  mocks.rows.set(1, [known("one")]); recoverRaySettlement(); stopRayOrderMonitoring(); mocks.rows.clear();
  mocks.read.mockResolvedValue([venue("one", "lose")]); pollRaySettlement(); await flush();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "lose" });
});
it("updates intermediate changes locally, keeps querying beyond five minutes and stops at the venue terminal state", async () => {
  mocks.rows.set(1, [known("one")]); mocks.read.mockResolvedValue([venue("one", "pending")]);
  pollRaySettlement(); await flush(); await nextPoll();
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.rows.get(1)?.[0]?.Status).toBe("Pending");
  vi.advanceTimersByTime(10 * 60_000); mocks.read.mockResolvedValue([venue("one", "none")]); pollRaySettlement(); await flush();
  expect(mocks.rows.get(1)?.[0]?.Status).toBe("None");
  mocks.read.mockResolvedValue([venue("one", "reject")]); await nextPoll(); await nextPoll();
  expect(mocks.read).toHaveBeenCalledTimes(4); expect(mocks.rows.get(1)?.[0]?.Status).toBe("Reject");
  expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "reject" });
});
it("database persistence is not needed to update the client and finish monitoring", async () => {
  mocks.rows.set(1, [known("one")]); mocks.read.mockResolvedValue([venue("one", "lose")]); mocks.save.mockRejectedValueOnce(new Error("database unavailable"));
  pollRaySettlement(); await flush();
  expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "lose" });
  await nextPoll(); await nextPoll(); expect(mocks.read).toHaveBeenCalledOnce();
});
it("a missing original or failed request cannot mark it closed", async () => {
  mocks.rows.set(1, [known("one")]); mocks.read.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([venue("one", "win")]);
  pollRaySettlement(); await flush(); expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "watching", error: expect.stringContaining("未返回") });
  await nextPoll(); expect(mocks.save).not.toHaveBeenCalled();
  await nextPoll(); expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "win" });
});
it("an account in the original confirmation flow is skipped until it becomes available", async () => {
  mocks.rows.set(1, [known("one")]); mocks.accounts[0]!.active = true; mocks.read.mockResolvedValue([venue("one", "win")]);
  pollRaySettlement(); await flush(); expect(mocks.read).not.toHaveBeenCalled();
  mocks.accounts[0]!.active = false; await nextPoll(); expect(mocks.read).toHaveBeenCalledOnce();
});
it("logout during a request prevents late writes into the next user's session", async () => {
  mocks.rows.set(1, [known("one")]); let resolve!: (rows: VenueOrder[]) => void;
  mocks.read.mockImplementation(() => new Promise((r) => { resolve = r; }));
  pollRaySettlement(); stopRayOrderMonitoring(); mocks.owner = "next-owner";
  resolve([venue("one", "lose")]); await flush(); expect(mocks.rows.get(1)?.[0]?.Status).toBe("None");
});
it("an empty task list and terminal or other-venue originals never cause a venue query", async () => {
  pollRaySettlement(); await flush(); mocks.rows.set(1, [{ ...known("done"), Status: "Win" }, { ...known("ob"), Type: "OB" }]);
  await nextPoll(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("a query returning during a new confirmation window cannot save its old data", async () => {
  mocks.rows.set(1, [known("one")]); let resolve!: (rows: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  pollRaySettlement(); mocks.accounts[0]!.active = true; resolve([venue("one", "lose")]); await flush();
  expect(mocks.rows.get(1)?.[0]?.Status).toBe("None");
  mocks.accounts[0]!.active = false; mocks.read.mockResolvedValue([venue("one", "win")]); await nextPoll(); expect(mocks.rows.get(1)?.[0]?.Status).toBe("Win");
});
it("an in-flight query cannot overwrite an original already marked final in the current list", async () => {
  mocks.rows.set(1, [known("one")]); let resolve!: (rows: VenueOrder[]) => void;
  mocks.read.mockImplementation(() => new Promise((r) => { resolve = r; }));
  pollRaySettlement(); mocks.rows.set(1, [{ ...known("one"), Status: "Win" }]); resolve([venue("one", "lose")]); await flush();
  expect(mocks.rows.get(1)?.[0]?.Status).toBe("Win");
});
it.each(["replace", "token", "logout", "preview"])("discards old request after %s", async (change) => {
  mocks.rows.set(1, [known("one")]); let resolve!: (rows: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise((r) => { resolve = r; })); pollRaySettlement();
  if (change === "replace") mocks.accounts = [new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "replacement" })];
  if (change === "token") mocks.accounts[0]!.token = "new-token";
  if (change === "logout") mocks.owner = "";
  if (change === "preview") mocks.preview = true;
  resolve([venue("one", "lose")]); await flush(); expect(mocks.rows.get(1)?.[0]?.Status).toBe("None");
});
it("a trusted GTC identity does not interrupt monitoring or get invented in the ordinary writer", async () => {
  mocks.rows.set(1, [known("one")]); let resolve!: (rows: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise((r) => { resolve = r; })); pollRaySettlement();
  mocks.rows.set(1, [{ ...known("one"), PmGtcExecutionId: "execution", Link: 123 }]);
  resolve([venue("one", "lose")]); await flush();
  expect(mocks.rows.get(1)?.[0]).toMatchObject({ OrderID: "one", Status: "Lose", PmGtcExecutionId: "execution", Link: 123 });
  expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "lose" });
});
it("preserves sports and POD identity while updating an existing RAY order", async () => {
  mocks.rows.set(1, [{ ...known("one"), Domain: "sports", Sport: "football", Source: "football-pod-auto", PodClientId: "ticket", PodRayMatchId: "match" }]);
  mocks.read.mockResolvedValue([venue("one", "win")]); pollRaySettlement(); await flush();
  expect(mocks.rows.get(1)?.[0]).toMatchObject({ Status: "Win", Domain: "sports", Sport: "football", Source: "football-pod-auto", PodClientId: "ticket", PodRayMatchId: "match" });
});
it("a terminal record recovered from the database stops an old session task without a venue query", async () => {
  mocks.rows.set(1, [known("one")]); recoverRaySettlement(); stopRayOrderMonitoring(); mocks.rows.clear();
  mocks.load.mockResolvedValue([{ ...known("one"), Status: "Win" }]); mocks.accounts[0]!.active = true;
  pollRaySettlement(); await flush(); mocks.accounts[0]!.active = false; await nextPoll();
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.load).toHaveBeenCalledWith(2, ["one"]);
});
it("a failed database recovery retries and never blocks known originals", async () => {
  mocks.rows.set(1, [known("one")]); mocks.load.mockRejectedValueOnce(new Error("database down")).mockResolvedValue([known("old")]);
  mocks.read.mockResolvedValue([venue("one", "none"), venue("old", "none")]); pollRaySettlement(); await flush();
  await nextPoll(); expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledTimes(2);
});
