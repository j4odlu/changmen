import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProvider } from "@/runtime/providers";
import { observedRayOrders, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./runtime";
import { beginRaySubmissionPreview, finishRaySubmissionPreviewChecks, observeRaySubmissionPreviews, projectRaySubmissionPreviews, retireRaySubmissionPreviews } from "./submissionPreview";
import { useRayOrderContextStore } from "./contextStore";

const mock = vi.hoisted(() => ({ submit: vi.fn(), rawRead: vi.fn(), regularRead: vi.fn(), makeup: vi.fn(),
  owner: "u1", preview: false, accounts: [] as PlatformAccount[], rows: new Map(),
  save: vi.fn(), bind: vi.fn(), refresh: vi.fn(), profit: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mock.owner, isAuthSessionCurrent: (owner: string) => owner === mock.owner }));
vi.mock("@/runtime/venueAdapters", () => ({ getProvider: () => ({ betting: mock.submit, getOrders: mock.rawRead }) }));
vi.mock("@/runtime/orderPolling/ray", () => ({ readRayAccountOrders: mock.regularRead, resetRayOrderPolling: vi.fn() }));
vi.mock("./api", () => ({ loadRayMonitorOrders: vi.fn().mockResolvedValue([]) }));
vi.mock("@/api/order", () => ({ saveOrders: mock.save }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbOrderId: mock.bind, refreshOrderListAfterBind: mock.refresh }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ get userId() { return mock.owner; }, get isLoggedIn() { return !!mock.owner; } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mock.accounts, get adminWorkspacePreview() { return mock.preview; },
  findAccount: (id: number) => mock.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mock.rows, updateTodayProfit: mock.profit }) }));
vi.mock("./autoMakeup", () => ({ handleRayLateRejectAutoMakeup: mock.makeup }));
const now = new Date("2026-10-19T10:00:00+08:00").getTime();
const link = now - 100;
const account = () => mock.accounts[0]!;
function option() {
  const value = new BetOption("RAY", "123", "10", "456", 70, "Away", 2);
  value.diagnosticLinkId = link; value.data = { prepared: true };
  value.diagnosticAttempt = "initial";
  return value;
}
function venue(id = "one", status: VenueOrder["status"] = "none"): VenueOrder {
  return { provider: "RAY", orderId: id, status, odds: 2, betMoney: 70, createAt: now,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", game: "CS2", money: 0, reward: 0,
    venueMatchId: "123", venueItemId: "456" };
}
const display = () => projectRaySubmissionPreviews([], "2026-10-19", 0);
function finishChecks(rejected = false, orders: VenueOrder[] = [venue()], pending = false) {
  finishRaySubmissionPreviewChecks({ linkId: link, accountA: account(), accountB: undefined, legA: option(), legB: option() }, {
    rejectA: rejected, rejectB: false, pendingConfirmA: pending, pendingConfirmB: false, ordersA: orders, ordersB: [],
  });
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }
beforeEach(() => {
  setActivePinia(createPinia()); stopRayOrderMonitoring(); resetRayOrderResults(); sessionStorage.clear();
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mock.owner = "u1"; mock.preview = false; mock.rows.clear();
  mock.accounts = [{ accountId: 2, provider: "RAY", playerName: "RAY", token: "token", gateway: "https://ray.example", active: true } as PlatformAccount];
  mock.submit.mockResolvedValue(new BetResult("RAY", true)); mock.rawRead.mockResolvedValue([venue()]); mock.regularRead.mockResolvedValue([]);
});
afterEach(() => {
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled(); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.makeup).not.toHaveBeenCalled(); expect(mock.profit).not.toHaveBeenCalled();
  stopRayOrderMonitoring(); vi.useRealTimers();
});

it("starts immediately after a successful main-loop submission while confirmation is still active, without awaiting the read", async () => {
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring();
  const input = option(); const data = input.data; const result = await getProvider(account())!.betting(account(), input);
  expect(result.success).toBe(true); await flush();
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith(account(), input); expect(input.data).toBe(data);
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(mock.regularRead).not.toHaveBeenCalled();
  expect(display()).toEqual([]); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(10_000); expect(mock.rawRead).toHaveBeenCalledOnce();
  release([venue()]); await flush();
  expect(display()[0]).toEqual([link, [expect.objectContaining({ DisplayOnly: true, OrderID: "one", Status: "RayConfirming" })]]);
  expect(mock.rows.size).toBe(0); expect(useRayOrderContextStore().tasks.size).toBe(0);
  expect(observedRayOrders(account())).toBeUndefined();
});

it("retries missing venue orders every five seconds and keeps early rejects confirming until rejection detection completes", async () => {
  mock.rawRead.mockResolvedValueOnce([]).mockResolvedValue([venue("one", "reject")]);
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()).toEqual([]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.rawRead).toHaveBeenCalledTimes(2);
  expect(display()[0]![1][0]).toMatchObject({ Status: "RayConfirming", DisplayOnly: true });
  expect(useRayOrderContextStore().tasks.size).toBe(0); expect(mock.regularRead).not.toHaveBeenCalled();
});

it("formal synchronization replaces the preview without duplicates or changes to the stored Link", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link + 1, Status: "None" };
  expect(projectRaySubmissionPreviews([[link + 1, [formal]]], "2026-10-19", 0)[0]![1][0]).toMatchObject({ Status: "RayConfirming" });
  expect(formal.Status).toBe("None");
  finishChecks();
  expect(projectRaySubmissionPreviews([[link + 1, [formal]]], "2026-10-19", 0)).toEqual([[link + 1, [formal]]]);
  mock.rows.set(link + 1, [formal]); account().active = false;
  await vi.advanceTimersByTimeAsync(5000);
  expect(display()).toEqual([]); expect(formal.Link).toBe(link + 1);
});

it.each([false, true])("uses the original rejection result (%s), even when early venue status disagrees", (rejected) => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue("one", rejected ? "none" : "reject")], now);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  finishChecks(rejected, [venue("one", rejected ? "reject" : "none")]);
  expect(display()[0]![1][0]!.Status).toBe(rejected ? "Reject" : "None");
  // 检测前发起的慢请求不能覆盖刚完成的检测结果。
  observeRaySubmissionPreviews(account(), [venue("one", rejected ? "none" : "reject")], now);
  expect(display()[0]![1][0]!.Status).toBe(rejected ? "Reject" : "None");
});

it("retains the confirming overlay when synchronization arrives before the check and waits for a matching formal rejection", () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "None" };
  retireRaySubmissionPreviews([formal]);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  finishChecks(true, [venue("one", "reject")]); retireRaySubmissionPreviews([formal]);
  expect(projectRaySubmissionPreviews([[link, [formal]]], "2026-10-19", 0)[0]![1][0]!.Status).toBe("Reject");
  expect(formal.Status).toBe("None");
  retireRaySubmissionPreviews([{ ...formal, Status: "Reject" }]); expect(display()).toEqual([]);
});

it("missing orders and unfinished checks remain confirming, while later monitoring can observe a late reject", () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  finishChecks(false, [], true);
  observeRaySubmissionPreviews(account(), [venue()], now + 1);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  finishChecks(false, []);
  expect(display()[0]![1][0]!.Status).toBe("None");
  observeRaySubmissionPreviews(account(), [venue("one", "reject")], now + 1);
  expect(display()[0]![1][0]!.Status).toBe("Reject");
});

it("uses only the matching link, account and leg when consuming rejection results", () => {
  const input = option(); input.orderIndex = 2;
  beginRaySubmissionPreview(account(), input)!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  const placed = { linkId: link, accountA: undefined, accountB: account(), legA: option(), legB: option() };
  placed.legB.target = "Home";
  const facts = { rejectA: true, rejectB: false, pendingConfirmA: false, pendingConfirmB: false, ordersA: [], ordersB: [venue()] };
  finishRaySubmissionPreviewChecks(placed, facts);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  placed.legB.target = "Away";
  finishRaySubmissionPreviewChecks({ ...placed, linkId: link + 1 }, facts);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  finishRaySubmissionPreviewChecks(placed, facts);
  expect(display()[0]![1][0]!.Status).toBe("None");
  expect(facts).toEqual({ rejectA: true, rejectB: false, pendingConfirmA: false, pendingConfirmB: false, ordersA: [], ordersB: [venue()] });
});

it.each([0, 1])("a retry or single B leg with submission index %s still consumes the B rejection result", (orderIndex) => {
  const input = option(); input.orderIndex = orderIndex; input.diagnosticAttempt = "retry";
  beginRaySubmissionPreview(account(), input)!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  finishRaySubmissionPreviewChecks({ linkId: link, accountA: undefined, accountB: account(), legA: option(), legB: input }, {
    rejectA: false, rejectB: true, pendingConfirmA: false, pendingConfirmB: false, ordersA: [], ordersB: [venue("one", "reject")],
  });
  expect(display()[0]![1][0]!.Status).toBe("Reject");
});

it("manual submissions retain normal synchronization without waiting for an arbitrage check they never run", () => {
  const input = option(); input.diagnosticAttempt = undefined;
  beginRaySubmissionPreview(account(), input)!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  expect(display()[0]![1][0]!.Status).toBe("None");
  retireRaySubmissionPreviews([{ Type: "RAY", PlayerID: 2, OrderID: "one", Status: "None" }]);
  expect(display()).toEqual([]);
});

it("does not regress a formally settled order after rejection detection passes", () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now); finishChecks();
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "Win", Money: 70 };
  const entries: [number, import("@/types/order").OrderRow[]][] = [[link, [formal]]];
  expect(projectRaySubmissionPreviews(entries, "2026-10-19", 0)).toBe(entries);
  retireRaySubmissionPreviews([formal]); expect(display()).toEqual([]);
});

it("requires this submission's venue identity, time and a unique candidate", () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue("one"), venue("two")], now); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [{ ...venue(), venueItemId: "other" }], now); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [{ ...venue(), createAt: now - 2000 }], now); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [venue()], now - 1); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [venue()], now); expect(display()).toHaveLength(1);
  expect(projectRaySubmissionPreviews([], "2026-10-18", 0)).toEqual([]);
  expect(projectRaySubmissionPreviews([], "2026-10-19", 99)).toEqual([]);
});

it("does not mistake an already-known order in the same second for the new submission", () => {
  mock.rows.set(link - 1, [{ Type: "RAY", PlayerID: 2, OrderID: "old", CreateAt: now, Link: link - 1 }]);
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue("old")], now); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [venue("old"), venue("new")], now);
  expect(display()[0]![1][0]!.OrderID).toBe("new");
});

it.each(["logout", "credentials", "account_removed", "admin_preview"])("discards a late submission/read after %s", (change) => {
  const original = account(); const accept = beginRaySubmissionPreview(original, option())!;
  if (change === "logout") mock.owner = "u2";
  if (change === "credentials") original.token = "replacement";
  if (change === "account_removed") mock.accounts = [];
  if (change === "admin_preview") mock.preview = true;
  accept(new BetResult("RAY", true)); observeRaySubmissionPreviews(original, [venue()], now);
  expect(display()).toEqual([]);
});

it("failed submissions and non-RAY providers do not enable early queries", async () => {
  startRayOrderMonitoring(); mock.submit.mockResolvedValue(new BetResult("RAY", false));
  await getProvider(account())!.betting(account(), option()); await flush();
  const ob = { ...account(), provider: "OB" } as PlatformAccount;
  expect(beginRaySubmissionPreview(ob, option())).toBeUndefined();
  expect(getProvider(ob)!.betting).toBe(mock.submit);
  expect(mock.rawRead).not.toHaveBeenCalled(); expect(display()).toEqual([]);
  const entries = [[10, []], [20, []]] as [number, import("@/types/order").OrderRow[]][];
  expect(projectRaySubmissionPreviews(entries, "2026-10-19", 0)).toBe(entries);
});

it("a late preview response after monitoring stops cannot restore an order row", async () => {
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  stopRayOrderMonitoring(); release([venue("one", "reject")]); await flush();
  expect(display()).toEqual([]); expect(observedRayOrders(account())).toBeUndefined();
});

it("a slow early query cannot supply or overwrite the independent rejection-check response", async () => {
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  mock.rawRead.mockResolvedValueOnce([venue("one", "reject")]);
  const checked = await getProvider(account())!.getOrders!(account());
  expect(checked[0]!.status).toBe("reject"); expect(mock.rawRead).toHaveBeenCalledTimes(2);
  release([venue()]); await flush();
  expect(observedRayOrders(account())!.orders[0]!.status).toBe("reject");
  expect(checked[0]!.status).toBe("reject"); expect(useRayOrderContextStore().tasks.size).toBe(0);
});
