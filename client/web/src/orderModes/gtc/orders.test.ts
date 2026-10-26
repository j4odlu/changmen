import type { PlatformAccount } from "@/models/platformAccount";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { nextTick } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listLocalGtc } from "./localStore";
import { listStoredGtcOrders, mutateStoredGtcOrder } from "./orderStore";
import { gtcOrders } from "./orderState";
import { stopNativeGtcOrders } from "./orderRuntime";
import { cancelGtcOrder, getGtcOrder, prepareGtcOrder, refreshGtcOrder, submitGtcOrder, subscribeGtcOrder } from "./orders";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn(), read: vi.fn(), cancel: vi.fn(),
  session: 1, valid: true, preview: false, maker: "", user: { userId: "owner", isLoggedIn: true }, account: {} as PlatformAccount,
}));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (stamp: number) => mocks.valid && mocks.session === stamp }));
vi.mock("@/stores/userStore", async () => {
  const { reactive } = await import("vue"); mocks.user = reactive(mocks.user);
  return { useUserStore: () => mocks.user };
});
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ adminWorkspacePreview: mocks.preview, findAccount: (id: number) => id === mocks.account.accountId ? mocks.account : undefined }) }));
vi.mock("@/runtime/orderMonitoring/loop", () => ({ createOrderMonitorLoop: () => ({ start: vi.fn(), stop: vi.fn() }) }));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", () => ({ prepareManualGtcBuy: mocks.prepare, pmSubmitMaker: (account: PlatformAccount) => account.token === "foreign-wallet" ? `0x${"c".repeat(40)}` : mocks.maker, readGtcFacts: mocks.read, pmCancelOrder: mocks.cancel }));
const option = { type: "Polymarket", itemId: "token", betId: "condition" } as never;
const hash = `0x${"b".repeat(64)}`;
beforeEach(() => {
  stopNativeGtcOrders(); sessionStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  mocks.user.userId = "owner"; mocks.user.isLoggedIn = true; mocks.session = 1; mocks.valid = true; mocks.preview = false; mocks.maker = `0x${"a".repeat(40)}`;
  mocks.account = { accountId: 1, provider: "Polymarket", currency: "USDT" } as PlatformAccount;
  mocks.prepare.mockResolvedValue({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5",
    protocol: 2, negRisk: false, route: "direct", orderHash: hash, validate: vi.fn(), prepareSubmit: vi.fn(async () => {}), submit: mocks.submit });
  mocks.submit.mockResolvedValue({ success: true, orderID: hash });
  mocks.read.mockResolvedValue({ order: { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: 1 });
  mocks.cancel.mockResolvedValue({ canceled: [hash] });
});
afterEach(stopNativeGtcOrders);
it("persists one native order without creating any old plan or fake opposite leg", async () => {
  const order = await submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option));
  expect(order).toMatchObject({ formatVersion: 2, orderType: "GTC", accountId: 1, orderId: hash, submit: "accepted", submissionClosed: true });
  expect(order).not.toHaveProperty("other"); expect(order.plan).not.toHaveProperty("source"); expect(order.plan).not.toHaveProperty("otherPlayerId");
  expect(order).not.toHaveProperty("groupComplete"); expect(order).not.toHaveProperty("released");
  expect(await listLocalGtc("owner")).toEqual([]);
  expect(await listStoredGtcOrders("owner")).toEqual([order]); expect(mocks.submit).toHaveBeenCalledOnce();
});
it("a signed handle cannot be sent twice, nor recreated under another id", async () => {
  const prepared = await prepareGtcOrder(mocks.account, option);
  await submitGtcOrder(mocks.account, prepared);
  await expect(submitGtcOrder(mocks.account, prepared)).rejects.toThrow("禁止重复提交");
  await expect(submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option))).rejects.toThrow("禁止重复发送");
  expect(mocks.submit).toHaveBeenCalledOnce();
});
it("persists unknown transport results without authorizing a second buy", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("timeout")); mocks.read.mockRejectedValue(new Error("query offline"));
  const order = await submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option));
  expect(order.submit).toBe("unknown");
  const restored = (await listStoredGtcOrders("owner"))[0]!;
  expect(restored).toMatchObject({ pmAuthorized: true, submit: "unknown", submissionClosed: true });
  await expect(mutateStoredGtcOrder("owner", order.id, restored.revision, { kind: "authorize" })).rejects.toThrow("禁止重发");
  await expect(refreshGtcOrder(order.id)).rejects.toThrow("query offline"); expect(mocks.submit).toHaveBeenCalledOnce();
});
it("cannot use another account or another session's preparation", async () => {
  const prepared = await prepareGtcOrder(mocks.account, option);
  await expect(submitGtcOrder({ ...mocks.account, accountId: 2 } as PlatformAccount, prepared)).rejects.toThrow("当前账号或会话");
  mocks.session++;
  await expect(submitGtcOrder(mocks.account, prepared)).rejects.toThrow("当前账号或会话"); expect(mocks.submit).not.toHaveBeenCalled();
});
it("client storage failure blocks the new API before any POST", async () => {
  const prepared = await prepareGtcOrder(mocks.account, option); vi.stubGlobal("indexedDB", undefined);
  await expect(submitGtcOrder(mocks.account, prepared)).rejects.toThrow("尚未发送"); expect(mocks.submit).not.toHaveBeenCalled();
});
it("readers receive detached snapshots and subscriptions can be stopped", async () => {
  const order = await submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option));
  const listener = vi.fn(); const stop = subscribeGtcOrder(order.id, listener);
  expect(listener).toHaveBeenCalledOnce();
  const snapshot = getGtcOrder(order.id)!; snapshot.plan.shares = "999";
  expect(getGtcOrder(order.id)!.plan.shares).toBe("10");
  gtcOrders.records[0]!.matched = "2"; await nextTick();
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ matched: "2" }), expect.anything(), expect.anything());
  stop(); const calls = listener.mock.calls.length;
  gtcOrders.records[0]!.matched = "3"; await nextTick(); expect(listener).toHaveBeenCalledTimes(calls);
  await cancelGtcOrder(order.id); expect(mocks.cancel).toHaveBeenCalledWith(mocks.account, hash); expect(mocks.submit).toHaveBeenCalledOnce();
});
it("order reads do not expose the previous user's session", async () => {
  const order = await submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option));
  mocks.user.userId = "other-owner"; expect(getGtcOrder(order.id)).toBeUndefined();
  mocks.user.userId = "owner"; mocks.user.isLoggedIn = false; expect(getGtcOrder(order.id)).toBeUndefined();
});
it("a session change during the final original-order query cannot expose the old result", async () => {
  const prepared = await prepareGtcOrder(mocks.account, option);
  mocks.read.mockImplementationOnce(async () => { mocks.session++; throw new Error("session changed"); });
  await expect(submitGtcOrder(mocks.account, prepared)).rejects.toThrow("会话已变更");
  expect(mocks.submit).toHaveBeenCalledOnce(); expect((await listStoredGtcOrders("owner"))[0]!.orderId).toBe(hash);
});
it("refresh and cancellation reject another user's record before querying the venue", async () => {
  const order = await submitGtcOrder(mocks.account, await prepareGtcOrder(mocks.account, option));
  const reads = mocks.read.mock.calls.length; mocks.user.userId = "other-owner";
  await expect(refreshGtcOrder(order.id)).rejects.toThrow("当前会话"); await expect(cancelGtcOrder(order.id)).rejects.toThrow("当前会话");
  expect(mocks.read).toHaveBeenCalledTimes(reads); expect(mocks.cancel).not.toHaveBeenCalled();
});
it.each(["preview", "invalid-wallet", "foreign-wallet"])("%s cannot reserve or submit an order", async reason => {
  const account = reason === "foreign-wallet" ? { ...mocks.account, token: "foreign-wallet" } as PlatformAccount : mocks.account;
  const prepared = await prepareGtcOrder(account, option);
  if (reason === "preview") mocks.preview = true;
  if (reason === "invalid-wallet") mocks.maker = "invalid";
  await expect(submitGtcOrder(account, prepared)).rejects.toThrow();
  expect(mocks.submit).not.toHaveBeenCalled(); expect(await listStoredGtcOrders("owner")).toEqual([]);
});
it("invalid result association is rejected before any venue submission", async () => {
  const prepared = await prepareGtcOrder(mocks.account, option);
  await expect(submitGtcOrder(mocks.account, prepared, { linkId: Number.NaN })).rejects.toThrow("尚未发送");
  expect(mocks.submit).not.toHaveBeenCalled(); expect(await listStoredGtcOrders("owner")).toEqual([]);
});
