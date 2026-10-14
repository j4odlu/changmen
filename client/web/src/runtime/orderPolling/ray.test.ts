import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { readRayAccountOrders, resetRayOrderPolling } from "./ray";

const mocks = vi.hoisted(() => ({ read: vi.fn(), session: "owner:1", valid: true }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mocks.read }) }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (version: string) => mocks.valid && version === mocks.session }));
const account = (id = 2) => new PlatformAccount({ accountId: id, provider: "RAY", playerName: "RAY", gateway: "https://ray.example", token: "test-token" });
beforeEach(() => { resetRayOrderPolling(); vi.resetAllMocks(); mocks.session = "owner:1"; mocks.valid = true; mocks.read.mockResolvedValue([]); });
afterEach(() => resetRayOrderPolling());

it("concurrent originals share one account request, while a later round reads fresh data", async () => {
  const acc = account();
  await Promise.all([readRayAccountOrders(acc), readRayAccountOrders(acc), readRayAccountOrders(account())]);
  expect(mocks.read).toHaveBeenCalledOnce();
  await readRayAccountOrders(acc);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("distinct accounts never share an order response", async () => {
  await Promise.all([readRayAccountOrders(account(2)), readRayAccountOrders(account(3))]);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("a failed shared request is retried on the next round", async () => {
  mocks.read.mockRejectedValueOnce(new Error("Network Error"));
  const result = await Promise.allSettled([readRayAccountOrders(account()), readRayAccountOrders(account())]);
  expect(result.map(row => row.status)).toEqual(["rejected", "rejected"]);
  await readRayAccountOrders(account());
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("session reset discards late data without removing the new session's shared request", async () => {
  let oldResolve!: (value: []) => void; let newResolve!: (value: []) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { newResolve = resolve; }));
  const old = readRayAccountOrders(account());
  const oldResult = expect(old).rejects.toThrow("会话已变更");
  await Promise.resolve(); resetRayOrderPolling(); mocks.session = "owner:2";
  const next = readRayAccountOrders(account()); await Promise.resolve();
  oldResolve([]); await oldResult;
  const shared = readRayAccountOrders(account());
  expect(shared).toBe(next); newResolve([]); await next;
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("changed credentials do not reuse a request made with the previous token", async () => {
  const acc = account(); const old = readRayAccountOrders(acc);
  const oldResult = expect(old).rejects.toThrow("会话已变更");
  await Promise.resolve(); acc.token = "new-token";
  const next = readRayAccountOrders(acc); await oldResult; await next;
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("confirmation reads bypass an older monitor request and discard its stale response", async () => {
  const acc = account();
  let release!: (value: []) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
    .mockResolvedValueOnce([{ orderId: "new-rejected", status: "reject" }]);
  const background = readRayAccountOrders(acc);
  const discarded = expect(background).rejects.toThrow("新的回执确认替代");
  await Promise.resolve();
  const confirmation = readRayAccountOrders(acc, { fresh: true });
  await Promise.resolve();
  expect(await confirmation).toMatchObject([{ orderId: "new-rejected", status: "reject" }]);
  release([]); await discarded;
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("a superseded monitor completing cannot evict the new shared monitor request", async () => {
  const acc = account();
  let release!: (value: []) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const background = readRayAccountOrders(acc);
  const discarded = expect(background).rejects.toThrow("新的回执确认替代");
  await Promise.resolve();
  await readRayAccountOrders(acc, { fresh: true });
  let releaseNext!: (value: []) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { releaseNext = resolve; }));
  const next = readRayAccountOrders(acc); await Promise.resolve();
  release([]); await discarded;
  expect(readRayAccountOrders(acc)).toBe(next);
  expect(mocks.read).toHaveBeenCalledTimes(3);
  releaseNext([]); await next;
});

it.each(["reset", "token", "session"])("fresh confirmation discards late data after %s", async (change) => {
  const acc = account();
  let release!: (value: []) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const confirmation = readRayAccountOrders(acc, { fresh: true });
  const rejected = expect(confirmation).rejects.toThrow("会话已变更");
  await Promise.resolve();
  if (change === "reset") resetRayOrderPolling();
  if (change === "token") acc.token = "new-token";
  if (change === "session") mocks.session = "owner:2";
  release([]); await rejected;
});
