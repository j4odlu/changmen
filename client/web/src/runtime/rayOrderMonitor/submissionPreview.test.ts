import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowReactive } from "vue";
import { getProvider } from "@/runtime/providers";
import { observedRayOrders, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./runtime";
import { beginRaySubmissionPreview, observeRaySubmissionPreviews, projectRaySubmissionPreviews, retireRaySubmissionPreviews } from "./submissionPreview";
import { useRayOrderContextStore } from "./contextStore";
import { registerRayOrderContext } from "./contexts";

const mock = vi.hoisted(() => ({ submit: vi.fn(), rawRead: vi.fn(), regularRead: vi.fn(), makeup: vi.fn(),
  owner: "u1", preview: false, lateMakeup: false, expectedMakeup: 0, accounts: [] as PlatformAccount[], rows: new Map(),
  save: vi.fn(), bind: vi.fn(), refresh: vi.fn(), profit: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mock.owner, isAuthSessionCurrent: (owner: string) => owner === mock.owner }));
vi.mock("@/runtime/venueAdapters", () => ({ getProvider: () => ({ betting: mock.submit, getOrders: mock.rawRead }) }));
vi.mock("@/runtime/orderPolling/ray", () => ({ readRayAccountOrders: mock.regularRead, resetRayOrderPolling: vi.fn() }));
vi.mock("./api", () => ({ loadRayMonitorOrders: vi.fn().mockResolvedValue([]) }));
vi.mock("@/api/order", () => ({ saveOrders: mock.save }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbOrderId: mock.bind, refreshOrderListAfterBind: mock.refresh }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ get userId() { return mock.owner; }, get isLoggedIn() { return !!mock.owner; }, get extensionPrefs() { return { rayLateRejectAutoMakeup: { enabled: mock.lateMakeup } }; } }) }));
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
async function flush() { await vi.advanceTimersByTimeAsync(0); }
beforeEach(() => {
  setActivePinia(createPinia()); stopRayOrderMonitoring(); resetRayOrderResults(); sessionStorage.clear();
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mock.owner = "u1"; mock.preview = false; mock.lateMakeup = false; mock.expectedMakeup = 0; mock.rows = shallowReactive(new Map());
  mock.accounts = [{ accountId: 2, provider: "RAY", playerName: "RAY", token: "token", gateway: "https://ray.example", active: true } as PlatformAccount];
  mock.submit.mockResolvedValue(new BetResult("RAY", true)); mock.rawRead.mockResolvedValue([venue()]); mock.regularRead.mockResolvedValue([]);
});
afterEach(() => {
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled(); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.makeup).toHaveBeenCalledTimes(mock.expectedMakeup); expect(mock.profit).not.toHaveBeenCalled();
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

it("an inactive retry account uses only the display reader, even when its slow response crosses rejection detection", async () => {
  account().active = false; mock.lateMakeup = true;
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring();
  const input = option(); input.diagnosticAttempt = "retry";
  await getProvider(account())!.betting(account(), input); await flush();
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(mock.regularRead).not.toHaveBeenCalled();
  mock.rawRead.mockResolvedValueOnce([venue()]);
  const checked = await getProvider(account())!.getOrders!(account());
  registerRayOrderContext({ linkId: link, matchId: 123, betId: 10, side: "B", accountId: 2, submittedAt: now,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 3, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: checked, initialRejected: false });
  release([venue("one", "reject")]); await flush();
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  expect(observedRayOrders(account())!.orders[0]!.status).toBe("none");
  expect(display()[0]![1][0]).toMatchObject({ DisplayOnly: true, Status: "RayConfirming" });
  expect(mock.regularRead).not.toHaveBeenCalled(); expect(mock.makeup).not.toHaveBeenCalled();
});

it.each(["none", "reject", "win", "lose", "return"] as const)("stops display queries after finding a %s order, without waiting for formal persistence", async (status) => {
  account().active = false; mock.rawRead.mockResolvedValue([venue("one", status)]);
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(mock.regularRead).not.toHaveBeenCalled();
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
});

it("a business terminal result ends business polling while a display row waits for persistence", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  registerRayOrderContext({ linkId: link, matchId: 123, betId: 10, side: "A", accountId: 2, submittedAt: now,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 3, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: [venue()], initialRejected: false });
  account().active = false; mock.regularRead.mockResolvedValue([venue("one", "reject")]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("rejected");
  expect(mock.regularRead).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mock.regularRead).toHaveBeenCalledOnce(); expect(mock.rawRead).toHaveBeenCalledOnce();
});

it("retries display read failures and can display a later submission after the first query has stopped", async () => {
  mock.rawRead.mockRejectedValueOnce(new Error("temporary"));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()).toEqual([]); await vi.advanceTimersByTimeAsync(5000);
  expect(display()).toHaveLength(1); expect(mock.rawRead).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  const next = option(); next.diagnosticLinkId = Date.now();
  mock.rawRead.mockResolvedValue([{ ...venue("two"), createAt: Date.now() }]);
  await getProvider(account())!.betting(account(), next); await flush();
  expect(display()).toHaveLength(2); expect(mock.rawRead).toHaveBeenCalledTimes(3);
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

it.each(["None", "Reject", "Win"])("formal %s orders immediately replace previews, before any rejection result handoff", async (status) => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link + 1, Status: status };
  const entries: [number, import("@/types/order").OrderRow[]][] = [[link + 1, [formal]]];
  expect(projectRaySubmissionPreviews(entries, "2026-10-19", 0)).toBe(entries);
  expect(formal.Status).toBe(status); expect(formal.Link).toBe(link + 1);
  retireRaySubmissionPreviews([formal]); expect(display()).toEqual([]);
  observeRaySubmissionPreviews(account(), [venue()], now + 1);
  expect(display()).toEqual([]);
});

it("retirement matches the account and order ID and excludes other display-only rows", () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  retireRaySubmissionPreviews([{ Type: "RAY", PlayerID: 99, OrderID: "one", Status: "Reject" },
    { Type: "RAY", PlayerID: 2, OrderID: "other", Status: "Reject" },
    { DisplayOnly: true, Type: "RAY", PlayerID: 2, OrderID: "one", Status: "None" }]);
  expect(display()).toHaveLength(1);
  retireRaySubmissionPreviews([{ Type: "RAY", PlayerID: 2, OrderID: "one", Status: "Reject" }]);
  expect(display()).toEqual([]);
});

it("the display lifecycle deletes a preview as soon as the formal order store receives the same order", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()).toHaveLength(1);
  mock.rows.set(link, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "Reject" }]);
  await flush();
  expect(display()).toEqual([]);
  mock.rows.clear(); await flush();
  observeRaySubmissionPreviews(account(), [venue()], Date.now());
  expect(display()).toEqual([]);
});

it("does not overlap display reads for two submissions on the same account or assign an older response to the newer submission", async () => {
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(1);
  const next = option(); next.diagnosticLinkId = link + 1;
  await getProvider(account())!.betting(account(), next); await flush();
  expect(mock.rawRead).toHaveBeenCalledOnce();
  release([venue()]); await flush();
  expect(display()).toHaveLength(1); expect(display()[0]![0]).toBe(link);
  mock.rawRead.mockResolvedValue([venue(), { ...venue("two"), createAt: now + 1 }]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.rawRead).toHaveBeenCalledTimes(2); expect(display()).toHaveLength(2);
  expect(display()[0]![1][0]!.OrderID).toBe("two");
});

it("does not show the same venue order for two submissions matched in the same read", async () => {
  beginRaySubmissionPreview(account(), option())!(new BetResult("RAY", true));
  const next = option(); next.diagnosticLinkId = link + 1;
  beginRaySubmissionPreview(account(), next)!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue()], now);
  expect(display()).toHaveLength(1);
  observeRaySubmissionPreviews(account(), [venue(), venue("two")], now);
  expect(display()).toHaveLength(2);
  expect(display().flatMap(([, rows]) => rows.map(row => row.OrderID)).sort()).toEqual(["one", "two"]);
});

it.each(["logout", "credentials", "account_removed", "admin_preview"])("discards an in-flight display response after %s", async (change) => {
  const original = account();
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  if (change === "logout") mock.owner = "u2";
  if (change === "credentials") account().token = "replacement";
  if (change === "account_removed") mock.accounts = [];
  if (change === "admin_preview") mock.preview = true;
  release([venue()]); await flush();
  expect(display()).toEqual([]); expect(observedRayOrders(original)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(15_000); expect(mock.rawRead).toHaveBeenCalledOnce();
});

it.each([undefined, "initial", "retry"] as const)("previews stay read-only and confirming regardless of submission mode %s", (attempt) => {
  const input = option(); input.diagnosticAttempt = attempt; input.orderIndex = 1;
  beginRaySubmissionPreview(account(), input)!(new BetResult("RAY", true));
  observeRaySubmissionPreviews(account(), [venue("one", "reject")], now);
  expect(display()[0]![1][0]!.Status).toBe("RayConfirming");
  expect(useRayOrderContextStore().tasks.size).toBe(0);
});

it("an early slow response stays read-only after confirmation; only a new monitor query may process a late rejection", async () => {
  let release!: (orders: VenueOrder[]) => void;
  mock.lateMakeup = true;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  mock.rawRead.mockResolvedValueOnce([venue()]);
  const checked = await getProvider(account())!.getOrders!(account());
  registerRayOrderContext({ linkId: link, matchId: 123, betId: 10, side: "A", accountId: 2, submittedAt: now,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 3, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: checked, initialRejected: false });
  account().active = false;
  release([venue("one", "reject")]); await flush();
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  expect(mock.makeup).not.toHaveBeenCalled(); expect(mock.regularRead).not.toHaveBeenCalled();
  expect(observedRayOrders(account())!.orders[0]!.status).toBe("none");
  mock.regularRead.mockResolvedValue([venue("one", "reject")]); mock.expectedMakeup = 1;
  await vi.advanceTimersByTimeAsync(5000);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("rejected");
  expect(mock.makeup).toHaveBeenCalledOnce();
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
