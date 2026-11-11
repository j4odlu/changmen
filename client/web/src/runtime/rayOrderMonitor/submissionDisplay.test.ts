import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowReactive } from "vue";
import { getProvider } from "@/runtime/providers";
import { beginRayOrderObservation, observedRayOrders, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./runtime";
import { beginRaySubmissionDisplay, observeRaySubmissionDisplays, projectRaySubmissionDisplays, retireRaySubmissionDisplays } from "./submissionDisplay";
import { useRayOrderContextStore } from "./contextStore";
import { registerRayOrderContext } from "./contexts";
import { rayProvider, lookupRayNativeOrderDisplay } from "@changmen/venue-browser/adapter/ray/bet";
import { resolveRayOrderDisplayStatus } from "@/shared/rayOrderDisplay";

const accountHttp = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-browser/adapter/ray/accountHttp", () => ({ accountGet: accountHttp, accountPostForm: vi.fn() }));

const mock = vi.hoisted(() => ({ submit: vi.fn(), rawRead: vi.fn(), regularRead: vi.fn(), makeup: vi.fn(),
  owner: "u1", preview: false, lateMakeup: false, expectedMakeup: 0, expectedProfit: 0, accounts: [] as PlatformAccount[], rows: new Map(),
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
function baseline(orders: VenueOrder[] = [venue("baseline-old")]) { beginRayOrderObservation(account())(orders); }
const display = () => projectRaySubmissionDisplays([], "2026-10-19", 0);
async function flush() { await vi.advanceTimersByTimeAsync(0); }
beforeEach(() => {
  setActivePinia(createPinia()); stopRayOrderMonitoring(); resetRayOrderResults(); sessionStorage.clear();
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mock.owner = "u1"; mock.preview = false; mock.lateMakeup = false; mock.expectedMakeup = 0; mock.expectedProfit = 0; mock.rows = shallowReactive(new Map());
  mock.accounts = [{ accountId: 2, provider: "RAY", playerName: "RAY", token: "token", gateway: "https://ray.example", active: true } as PlatformAccount];
  mock.submit.mockResolvedValue(new BetResult("RAY", true)); mock.rawRead.mockResolvedValue([venue()]); mock.regularRead.mockResolvedValue([]);
  baseline();
});
afterEach(() => {
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled(); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.makeup).toHaveBeenCalledTimes(mock.expectedMakeup); expect(mock.profit).toHaveBeenCalledTimes(mock.expectedProfit);
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
  expect(display()[0]).toEqual([link, [expect.objectContaining({ DisplayOnly: true, OrderID: "one", Status: "None" })]]);
  expect(mock.rows.size).toBe(0); expect(useRayOrderContextStore().tasks.size).toBe(0);
  expect(observedRayOrders(account())?.orders).toEqual([venue("baseline-old")]);
});

it.each([1_800, 5_000, 30_000, 120_000])("shows the real order before rejection detection when the venue clock is %sms behind", async clockDrift => {
  const order = { ...venue(), createAt: now - clockDrift };
  mock.rawRead.mockResolvedValue([order]);
  startRayOrderMonitoring();
  await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()[0]).toEqual([link, [expect.objectContaining({
    DisplayOnly: true, OrderID: "one", Status: "None", CreateAt: order.createAt,
  })]]);
  expect(Date.now()).toBe(now);
  expect(account().active).toBe(true);
  expect(mock.rawRead).toHaveBeenCalledOnce();
  expect(mock.regularRead).not.toHaveBeenCalled();
  expect(mock.rows.size).toBe(0);
  expect(useRayOrderContextStore().tasks.size).toBe(0);
  expect(observedRayOrders(account())?.orders).toEqual([venue("baseline-old")]);
  expect(order.status).toBe("none");
});

it("does not attach an unknown historical order without a pre-submission venue snapshot", () => {
  resetRayOrderResults();
  const old = { ...venue("old"), createAt: now - 60_000 };
  mock.rows.set(link - 60_000, [{ Type: "RAY", PlayerID: 2, OrderID: "other" }]);
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [old], now);
  expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [old, venue("actual-new")], now + 5000);
  expect(display()).toEqual([]);
  baseline([old]);
  observeRaySubmissionDisplays(account(), [old, venue("actual-new")], now + 10_000);
  expect(display()).toEqual([]);
});

it.each([30_000, 60_000, 120_000])("waits for formal binding when the pre-submission snapshot is %sms old", age => {
  resetRayOrderResults(); vi.setSystemTime(now - age); baseline(); vi.setSystemTime(now);
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [{ ...venue("old"), createAt: now - 60_000 }], now);
  expect(display()).toEqual([]);
});

it("excludes the sixty-second-old order using the venue baseline and displays only the new order", () => {
  const old = { ...venue("old"), createAt: now - 60_000 }; baseline([old]);
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [old], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [old, venue("new")], now);
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "new", Status: "None", DisplayOnly: true });
});

it("does not choose between several new order IDs even when one is a higher scoring match", () => {
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue("one"), { ...venue("two"), odds: 2.04 }], now);
  expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [venue("one")], now + 5000);
  expect(display()).toEqual([]);
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
  expect(display()[0]![1][0]).toMatchObject({ DisplayOnly: true, Status: "Reject" });
  expect(mock.regularRead).not.toHaveBeenCalled(); expect(mock.makeup).not.toHaveBeenCalled();
});

it.each(["reject", "win", "lose", "return"] as const)("stops display queries after finding a terminal %s order, without waiting for formal persistence", async (status) => {
  account().active = false; mock.rawRead.mockResolvedValue([venue("one", status)]);
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(mock.regularRead).not.toHaveBeenCalled();
  expect(display()[0]![1][0]!.Status).toBe(status[0]!.toUpperCase() + status.slice(1));
});

it("keeps a located unsettled displayed order fresh and shows a later refusal during the original confirmation wait", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()[0]![1][0]!.Status).toBe("None");
  mock.rawRead.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce([venue("other", "reject"), venue()])
    .mockResolvedValue([venue("one", "reject")]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "one", Status: "None" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "one", Status: "Reject", DisplayOnly: true });
  const count = mock.rawRead.mock.calls.length;
  observeRaySubmissionDisplays(account(), [venue()], Date.now());
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mock.rawRead).toHaveBeenCalledTimes(count);
  expect(display()[0]![1][0]!.Status).toBe("Reject");
  expect(account().active).toBe(true);
  expect(mock.rows.size).toBe(0); expect(useRayOrderContextStore().tasks.size).toBe(0);
  expect(mock.regularRead).not.toHaveBeenCalled(); expect(observedRayOrders(account())?.orders).toEqual([venue("baseline-old")]);
});

it("one monitor response updates the displayed order and ends both demands at terminal", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  registerRayOrderContext({ linkId: link, matchId: 123, betId: 10, side: "A", accountId: 2, submittedAt: now,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 3, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: [venue()], initialRejected: false });
  account().active = false; mock.regularRead.mockResolvedValue([venue("one", "reject")]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("rejected");
  expect(mock.regularRead).toHaveBeenCalledOnce();
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "one", Status: "Reject" });
  expect(vi.getTimerCount()).toBe(1);
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
  expect(display()).toHaveLength(2); expect(mock.rawRead).toHaveBeenCalledTimes(4);
});

it("retries missing venue orders every five seconds and displays early refuses without starting rejection detection", async () => {
  mock.rawRead.mockResolvedValueOnce([]).mockResolvedValue([venue("one", "reject")]);
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()).toEqual([]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.rawRead).toHaveBeenCalledTimes(2);
  expect(display()[0]![1][0]).toMatchObject({ Status: "Reject", DisplayOnly: true });
  expect(useRayOrderContextStore().tasks.size).toBe(0); expect(mock.regularRead).not.toHaveBeenCalled();
});

it.each(["None", "Reject", "Win"])("formal %s orders immediately replace display-only rows, before any rejection result handoff", async (status) => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link + 1, Status: status };
  const entries: [number, import("@/types/order").OrderRow[]][] = [[link + 1, [formal]]];
  expect(projectRaySubmissionDisplays(entries, "2026-10-19", 0)).toBe(entries);
  expect(formal.Status).toBe(status); expect(formal.Link).toBe(link + 1);
  retireRaySubmissionDisplays([formal]); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [venue()], now + 1);
  expect(display()).toEqual([]);
});

it("retirement matches the account and order ID and excludes other display-only rows", () => {
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue()], now);
  retireRaySubmissionDisplays([{ Type: "RAY", PlayerID: 99, OrderID: "one", Status: "Reject" },
    { Type: "RAY", PlayerID: 2, OrderID: "other", Status: "Reject" },
    { DisplayOnly: true, Type: "RAY", PlayerID: 2, OrderID: "one", Status: "None" }]);
  expect(display()).toHaveLength(1);
  retireRaySubmissionDisplays([{ Type: "RAY", PlayerID: 2, OrderID: "one", Status: "Reject" }]);
  expect(display()).toEqual([]);
});

it("the display lifecycle retires a display-only order as soon as the formal order store receives the same order", async () => {
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(display()).toHaveLength(1);
  mock.rows.set(link, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "Reject" }]);
  await flush();
  expect(display()).toEqual([]);
  mock.rows.clear(); await flush();
  observeRaySubmissionDisplays(account(), [venue()], Date.now());
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
  expect(display()).toEqual([]);
  mock.rawRead.mockResolvedValue([venue(), { ...venue("two"), createAt: now + 1 }]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.rawRead).toHaveBeenCalledTimes(2); expect(display()).toEqual([]);
});

it("does not show the same venue order for two submissions matched in the same read", async () => {
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  const next = option(); next.diagnosticLinkId = link + 1;
  beginRaySubmissionDisplay(account(), next)!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue()], now);
  expect(display()).toHaveLength(0);
  observeRaySubmissionDisplays(account(), [venue(), venue("two")], now);
  expect(display()).toEqual([]);
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
  expect(display()).toEqual([]);
  expect(observedRayOrders(original)?.orders ?? []).toEqual(["account_removed", "admin_preview"].includes(change) ? [venue("baseline-old")] : []);
  await vi.advanceTimersByTimeAsync(15_000); expect(mock.rawRead).toHaveBeenCalledOnce();
});

it.each([undefined, "initial", "retry"] as const)("display-only orders show refusals and stay read-only regardless of submission mode %s", (attempt) => {
  const input = option(); input.diagnosticAttempt = attempt; input.orderIndex = 1;
  beginRaySubmissionDisplay(account(), input)!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue("one", "reject")], now);
  expect(display()[0]![1][0]!.Status).toBe("Reject");
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
  await vi.advanceTimersByTimeAsync(35_000);
  // 正式检测独立查单；确认后的正常监控接替慢展示请求，不等待它结束。
  const monitorReads = mock.regularRead.mock.calls.length;
  expect(monitorReads).toBeGreaterThan(0);
  release([venue("one", "reject")]); await flush();
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  expect(mock.makeup).not.toHaveBeenCalled(); expect(mock.regularRead).toHaveBeenCalledTimes(monitorReads);
  expect(observedRayOrders(account())!.orders[0]!.status).toBe("none");
  mock.regularRead.mockResolvedValue([venue("one", "reject")]); mock.expectedMakeup = 1;
  await vi.advanceTimersByTimeAsync(5000);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("rejected");
  expect(mock.makeup).toHaveBeenCalledOnce();
});

it("requires a single new order ID and exact venue identity and values", () => {
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [{ ...venue(), venueItemId: "other" }], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [{ ...venue(), betMoney: 71 }], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [{ ...venue(), odds: 2.01 }], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [{ ...venue(), venueMatchId: undefined }], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [venue()], now - 1); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [venue()], now); expect(display()).toHaveLength(1);
  expect(projectRaySubmissionDisplays([], "2026-10-18", 0)).toEqual([]);
  expect(projectRaySubmissionDisplays([], "2026-10-19", 99)).toEqual([]);
});

it("does not mistake an already-known order in the same second for the new submission", () => {
  mock.rows.set(link - 1, [{ Type: "RAY", PlayerID: 2, OrderID: "old", CreateAt: now, Link: link - 1 }]);
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue("old")], now); expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [venue("old"), venue("new")], now);
  expect(display()[0]![1][0]!.OrderID).toBe("new");
});

it.each(["logout", "credentials", "account_removed", "admin_preview"])("discards a late submission/read after %s", (change) => {
  const original = account(); const accept = beginRaySubmissionDisplay(original, option())!;
  if (change === "logout") mock.owner = "u2";
  if (change === "credentials") original.token = "replacement";
  if (change === "account_removed") mock.accounts = [];
  if (change === "admin_preview") mock.preview = true;
  accept(new BetResult("RAY", true)); observeRaySubmissionDisplays(original, [venue()], now);
  expect(display()).toEqual([]);
});

it("failed submissions and non-RAY providers do not enable early queries", async () => {
  startRayOrderMonitoring(); mock.submit.mockResolvedValue(new BetResult("RAY", false));
  await getProvider(account())!.betting(account(), option()); await flush();
  const ob = { ...account(), provider: "OB" } as PlatformAccount;
  expect(beginRaySubmissionDisplay(ob, option())).toBeUndefined();
  expect(getProvider(ob)!.betting).toBe(mock.submit);
  expect(mock.rawRead).not.toHaveBeenCalled(); expect(display()).toEqual([]);
  const entries = [[10, []], [20, []]] as [number, import("@/types/order").OrderRow[]][];
  expect(projectRaySubmissionDisplays(entries, "2026-10-19", 0)).toBe(entries);
});

it("a late display response after monitoring stops cannot restore an order row", async () => {
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  stopRayOrderMonitoring(); release([venue("one", "reject")]); await flush();
  expect(display()).toEqual([]); expect(observedRayOrders(account())?.orders).toEqual([venue("baseline-old")]);
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

it("displays the venue order fields and internal ID without inventing a confirming status", () => {
  const order = { ...venue("real-order", "win"), rayInternalOrderId: "native-42", money: 70 };
  const receipt = new BetResult("RAY", true);
  beginRaySubmissionDisplay(account(), option())!(receipt);
  expect(display()).toEqual([]);
  observeRaySubmissionDisplays(account(), [order], now);
  expect(display()[0]![1][0]).toMatchObject({ OrderID: order.orderId, RayInternalOrderId: "native-42",
    Status: "Win", Money: 70, Odds: order.odds, BetMoney: order.betMoney, CreateAt: order.createAt,
    Match: order.match, Bet: order.bet, Item: order.item });
  expect(receipt.orderId).toBeNull();
  expect(order.status).toBe("win");
});

it("stops unidentifiable display queries once normal synchronization supplies the Link order", async () => {
  resetRayOrderResults();
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(display()).toEqual([]);
  mock.rows.set(link, [{ Type: "RAY", PlayerID: 2, OrderID: "real-order", Link: link, Status: "None" }]);
  await flush();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mock.rawRead).toHaveBeenCalledOnce(); expect(display()).toEqual([]);
});

it("never assigns a located order to a later submission on the same account", () => {
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue()], now);
  const next = option(); next.diagnosticLinkId = link + 1;
  beginRaySubmissionDisplay(account(), next)!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [venue()], now);
  expect(display()).toHaveLength(1);
  observeRaySubmissionDisplays(account(), [venue(), venue("two")], now);
  expect(display()).toHaveLength(2);
  expect(display().flatMap(([, rows]) => rows.map(row => row.OrderID)).sort()).toEqual(["one", "two"]);
});

it("does not treat an empty snapshot as proof there were no historical orders", () => {
  baseline([]);
  beginRaySubmissionDisplay(account(), option())!(new BetResult("RAY", true));
  observeRaySubmissionDisplays(account(), [{ ...venue("unknown-old"), createAt: now - 60_000 }], now);
  expect(display()).toEqual([]);
});

function confirmedContext(linkId: number, order: VenueOrder) {
  registerRayOrderContext({ linkId, matchId: 123, betId: 10, side: "A", accountId: 2, submittedAt: order.createAt,
    match: order.match, bet: order.bet, item: order.item, target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 3, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: [order], initialRejected: false });
}

it("a new submission cannot start another background request or consume a prior monitor response", async () => {
  const oldLink = link - 60_000;
  const old = { ...venue("baseline-old"), createAt: now - 60_000 };
  baseline([old]); confirmedContext(oldLink, old); account().active = false; mock.lateMakeup = true;
  let release!: (orders: VenueOrder[]) => void;
  mock.regularRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await flush(); expect(mock.regularRead).toHaveBeenCalledOnce();
  vi.setSystemTime(now + 1);
  await getProvider(account())!.betting(account(), option()); await flush();
  expect(mock.rawRead).not.toHaveBeenCalled(); expect(display()).toEqual([]);
  release([{ ...old, status: "reject" }, venue()]); await flush();
  expect(display()).toEqual([]);
  expect(useRayOrderContextStore().taskForLink(oldLink)?.status).toBe("watching");
  expect(mock.makeup).not.toHaveBeenCalled();
  mock.regularRead.mockResolvedValue([{ ...old, status: "reject" }, venue()]); mock.expectedMakeup = 1;
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.rawRead).not.toHaveBeenCalled(); expect(mock.regularRead).toHaveBeenCalledTimes(2);
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "one", Status: "None" });
  expect(mock.makeup).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
});

it("a monitor request cannot process contexts handed over after that request began", async () => {
  const old = { ...venue("baseline-old"), createAt: now - 60_000 };
  confirmedContext(link - 60_000, old); account().active = false; mock.lateMakeup = true;
  let release!: (orders: VenueOrder[]) => void;
  mock.regularRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await flush();
  confirmedContext(link, venue());
  release([{ ...old, status: "reject" }, venue("one", "reject")]); await flush();
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  expect(mock.makeup).not.toHaveBeenCalled();
  mock.regularRead.mockResolvedValue([old, venue()]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.regularRead).toHaveBeenCalledTimes(2);
  expect(useRayOrderContextStore().taskForLink(link)?.lastObservedStatus).toBe("none");
});

it("two accounts may query concurrently while each account keeps one request and one order identity", async () => {
  const second = { ...account(), accountId: 4 } as PlatformAccount; mock.accounts.push(second);
  beginRayOrderObservation(second)([venue("baseline-old")]);
  const releases = new Map<number, (orders: VenueOrder[]) => void>();
  mock.rawRead.mockImplementation((account: PlatformAccount) => new Promise(resolve => { releases.set(account.accountId, resolve); }));
  startRayOrderMonitoring();
  await getProvider(account())!.betting(account(), option());
  const next = option(); next.diagnosticLinkId = link + 1;
  await getProvider(second)!.betting(second, next); await flush();
  expect(mock.rawRead).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000); expect(mock.rawRead).toHaveBeenCalledTimes(2);
  releases.get(2)!([venue("one", "reject")]); releases.get(4)!([venue("one", "reject")]); await flush();
  expect(display().flatMap(([, rows]) => rows.map(row => [row.PlayerID, row.OrderID])).sort())
    .toEqual([[2, "one"], [4, "one"]]);
  await vi.advanceTimersByTimeAsync(15_000); expect(mock.rawRead).toHaveBeenCalledTimes(2);
  expect(mock.regularRead).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
});

it("handoff: a slow display request cannot delay the first eligible monitor query after thirty seconds", async () => {
  let release!: (orders: VenueOrder[]) => void;
  mock.rawRead.mockImplementation(async () => Date.now() - now >= 25_000
    ? await new Promise<VenueOrder[]>(resolve => { release = resolve; }) : [venue()]);
  const reads: number[] = [];
  mock.regularRead.mockImplementation(async () => { reads.push(Date.now() - now); return [venue("one", "reject")]; });
  mock.lateMakeup = true;
  mock.makeup.mockImplementation(async (task, current) => {
    if (current()) useRayOrderContextStore().patch(task.key, { autoMakeupStatus: "enqueued" });
  });
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(30_001);
  confirmedContext(link, venue());
  mock.rows.set(link, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "None" }]);
  account().active = false; mock.expectedMakeup = 1; mock.expectedProfit = 1;
  await vi.advanceTimersByTimeAsync(4999);
  expect(reads).toEqual([35_000]);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("rejected");
  expect(mock.makeup).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000); release([venue()]); await flush();
  await vi.advanceTimersByTimeAsync(8000);
  expect(mock.rows.get(link)[0].Status).toBe("Reject");
  expect(mock.makeup).toHaveBeenCalledOnce(); expect(mock.regularRead).toHaveBeenCalledOnce();
});

it.each(["success", "error"])("handoff: an obsolete display %s cannot update state or release the replacement request lock", async (outcome) => {
  let finishDisplay!: () => void;
  let finishMonitor!: (orders: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise<VenueOrder[]>((resolve, reject) => {
    finishDisplay = () => outcome === "success" ? resolve([venue("one", "reject")]) : reject(new Error("old request failed"));
  }));
  mock.regularRead.mockImplementationOnce(() => new Promise<VenueOrder[]>(resolve => { finishMonitor = resolve; }));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(30_001);
  confirmedContext(link, venue()); account().active = false;
  await vi.advanceTimersByTimeAsync(4999);
  expect(mock.regularRead).toHaveBeenCalledOnce();
  finishDisplay(); await flush();
  expect(display()).toEqual([]);
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mock.regularRead).toHaveBeenCalledOnce(); expect(mock.makeup).not.toHaveBeenCalled();
  finishMonitor([venue()]); await flush();
  expect(display()[0]![1][0]).toMatchObject({ OrderID: "one", Status: "None" });
  expect(vi.getTimerCount()).toBe(1);
});

it.each(["missing", "error"])("retries an off-phase %s display result at its five-second deadline", async (outcome) => {
  const reads: number[] = [];
  mock.rawRead.mockImplementation(async () => {
    reads.push(Date.now() - now);
    if (outcome === "error") throw new Error("temporary");
    return [];
  });
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(1000);
  await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(5000);
  expect(reads).toEqual([1000, 6000]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(reads).toEqual([1000, 6000, 11000]);
  expect(mock.regularRead).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
});

it("display queries do not consume the existing business monitor's polling interval", async () => {
  const old = { ...venue("baseline-old"), createAt: now - 60_000 };
  confirmedContext(link - 60_000, old); account().active = false; mock.lateMakeup = true;
  const reads: number[] = [];
  mock.regularRead.mockImplementation(async () => {
    reads.push(Date.now() - now);
    return [{ ...old, status: reads.length === 1 ? "none" : "reject" }];
  });
  mock.makeup.mockImplementation(async (task, current) => {
    if (current()) useRayOrderContextStore().patch(task.key, { autoMakeupStatus: "enqueued" });
  });
  mock.rawRead.mockResolvedValue([]);
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(1000);
  await getProvider(account())!.betting(account(), option()); await flush();
  expect(mock.rawRead).toHaveBeenCalledOnce();
  mock.expectedMakeup = 1;
  await vi.advanceTimersByTimeAsync(4000);
  expect(reads).toEqual([0, 5000]);
  expect(useRayOrderContextStore().taskForLink(link - 60_000)?.status).toBe("rejected");
  expect(mock.makeup).toHaveBeenCalledOnce();
});

it("one timer honors different display deadlines for different accounts", async () => {
  const second = { ...account(), accountId: 4 } as PlatformAccount; mock.accounts.push(second);
  beginRayOrderObservation(second)([venue("baseline-old")]);
  const reads: [number, number][] = [];
  mock.rawRead.mockImplementation(async (account: PlatformAccount) => { reads.push([account.accountId, Date.now() - now]); return []; });
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(1000);
  await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(2000);
  const next = option(); next.diagnosticLinkId = link + 1;
  await getProvider(second)!.betting(second, next); await flush();
  await vi.advanceTimersByTimeAsync(5000);
  expect(reads).toEqual([[2, 1000], [4, 3000], [2, 6000], [4, 8000]]);
  expect(vi.getTimerCount()).toBe(1); expect(mock.regularRead).not.toHaveBeenCalled();
});

it("a display deadline does not run business observation ahead of its existing heartbeat", async () => {
  mock.rawRead.mockResolvedValueOnce([]).mockResolvedValue([venue("one", "reject")]);
  mock.regularRead.mockResolvedValue([venue("one", "reject")]); mock.lateMakeup = true;
  mock.makeup.mockImplementation(async (task, current) => {
    if (current()) useRayOrderContextStore().patch(task.key, { autoMakeupStatus: "enqueued" });
  });
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(1000);
  await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(4500);
  confirmedContext(link, venue()); account().active = false;
  await vi.advanceTimersByTimeAsync(500);
  expect(mock.rawRead).toHaveBeenCalledTimes(2); expect(mock.regularRead).not.toHaveBeenCalled();
  expect(display()[0]![1][0]!.Status).toBe("Reject");
  expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  expect(mock.makeup).not.toHaveBeenCalled();
  mock.expectedMakeup = 1;
  await vi.advanceTimersByTimeAsync(4000);
  expect(mock.regularRead).toHaveBeenCalledOnce(); expect(mock.makeup).toHaveBeenCalledOnce();
});

it("replacing a display request still honors the last business query's polling interval", async () => {
  account().active = false;
  const old = { ...venue("baseline-old"), createAt: now - 60_000 };
  let recover!: (rows: import("@/types/order").OrderRow[]) => void;
  const { loadRayMonitorOrders } = await import("./api");
  vi.mocked(loadRayMonitorOrders).mockImplementationOnce(() => new Promise(resolve => { recover = resolve; }));
  const reads: number[] = [];
  mock.regularRead.mockImplementation(async () => { reads.push(Date.now() - now); return [old]; });
  let release!: (rows: VenueOrder[]) => void;
  mock.rawRead.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(3000);
  recover([{ Type: "RAY", PlayerID: 2, OrderID: old.orderId, Link: link - 60_000, Status: "None" }]); await flush();
  expect(reads).toEqual([3000]);
  await vi.advanceTimersByTimeAsync(1000);
  await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads).toEqual([3000]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(reads).toEqual([3000, 10000]);
  release([]); await flush();
});

it.each(["success", "error"])("the real adapter cannot publish an obsolete display snapshot while its replacement ends with %s", async (outcome) => {
  accountHttp.mockReset();
  const open = { id: 42, order_number: "one", status: 0, live: 0, create_time: new Date(now).toISOString(),
    detail: [{ risk: 0, win: -1, stake: 70, odds: 2, match_id: "123", odds_id: "456", match_name: "Alpha vs Beta", title: "map1\nBeta" }] };
  accountHttp.mockResolvedValueOnce({ code: 200, result: [open] });
  await rayProvider.getOrders!(account());
  let finishDisplay!: (value: unknown) => void, finishMonitor!: () => void;
  accountHttp.mockImplementationOnce(() => new Promise(resolve => { finishDisplay = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishMonitor = () => outcome === "success" ? resolve({ code: 200, result: [open] }) : reject(new Error("monitor failed"));
    }));
  mock.rawRead.mockImplementation((account: PlatformAccount) => rayProvider.getOrders!(account));
  mock.regularRead.mockImplementation((account: PlatformAccount) => rayProvider.getOrders!(account));
  startRayOrderMonitoring(); await getProvider(account())!.betting(account(), option()); await flush();
  await vi.advanceTimersByTimeAsync(30_001);
  confirmedContext(link, venue());
  const formal = { Type: "RAY", PlayerID: 2, OrderID: "one", Link: link, Status: "None" };
  mock.rows.set(link, [formal]); account().active = false;
  await vi.advanceTimersByTimeAsync(4999);
  expect(mock.regularRead).toHaveBeenCalledOnce();
  finishDisplay({ code: 200, result: [{ ...open, status: 4, detail: [{ ...open.detail[0], risk: 2, win: 99 }] }] });
  await flush();
  const native = lookupRayNativeOrderDisplay(account(), "one");
  expect(native).toBe("Open"); expect(resolveRayOrderDisplayStatus(formal, native)).toBe("None");
  expect(formal.Status).toBe("None"); expect(useRayOrderContextStore().taskForLink(link)?.status).toBe("watching");
  mock.expectedProfit = outcome === "success" ? 1 : 0;
  finishMonitor(); await flush();
  expect(lookupRayNativeOrderDisplay(account(), "one")).toBe("Open");
});
