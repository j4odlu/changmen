import { beforeEach, expect, test, vi } from "vitest";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
const m = vi.hoisted(() => ({ session: "one", post: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => m.session, isAuthSessionCurrent: (version: string) => version === m.session,
  post: m.post, unwrap: (value: unknown) => value }));
const order = (orderId = "0xAbCd", status = "none", provider = "Polymarket") => ({ provider, orderId, status }) as VenueOrder;
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); m.session = "one"; m.post.mockResolvedValue({ success: 1 }); });

test("the initial Pending write never waits on itself, while the same terminal order waits until it completes", async () => {
  const { runPendingPmOrderWrite } = await import("./pendingPmOrderWrites");
  const { saveOrders } = await import("@/api/order");
  let finish!: () => void;
  m.post.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: 1 }); }));
  const pending = runPendingPmOrderWrite(9, "0xabcd", () => saveOrders({ accountId: 9 } as never, [order("0xAbCd", "pending")]));
  const terminal = saveOrders({ accountId: 9 } as never, [order()]);
  await vi.waitFor(() => expect(m.post).toHaveBeenCalledOnce());
  finish(); await Promise.all([pending, terminal]);
  expect(m.post).toHaveBeenCalledTimes(2);
  expect(JSON.parse(m.post.mock.calls[0][1].orders)[0].status).toBe("pending");
  expect(JSON.parse(m.post.mock.calls[1][1].orders)[0].status).toBe("none");
});

test("other accounts, orders and providers continue while one PM Pending write is in flight", async () => {
  const { runPendingPmOrderWrite, pendingPmOrderWriteBarrier } = await import("./pendingPmOrderWrites");
  const { saveOrders } = await import("@/api/order");
  let finish!: () => void;
  const pending = runPendingPmOrderWrite(9, "0xabcd", () => new Promise<void>(resolve => { finish = resolve; }));
  expect(pendingPmOrderWriteBarrier(10, [order()])).toBeUndefined();
  expect(pendingPmOrderWriteBarrier(9, [order("different")])).toBeUndefined();
  expect(pendingPmOrderWriteBarrier(9, [order("0xabcd", "none", "PB")])).toBeUndefined();
  await saveOrders({ accountId: 10 } as never, [order()]);
  await saveOrders({ accountId: 9 } as never, [order("different")]);
  await saveOrders({ accountId: 9 } as never, [order("0xabcd", "none", "PB")]);
  expect(m.post).toHaveBeenCalledTimes(3); finish(); await pending;
});

test("switching sessions while a terminal save waits cancels that save instead of sending it with the new session", async () => {
  const { runPendingPmOrderWrite } = await import("./pendingPmOrderWrites");
  const { saveOrders } = await import("@/api/order");
  let finish!: () => void;
  const pending = runPendingPmOrderWrite(9, "0xabcd", () => new Promise<void>(resolve => { finish = resolve; }));
  const terminal = saveOrders({ accountId: 9 } as never, [order()]);
  const rejected = expect(terminal).rejects.toThrow("会话已切换");
  await Promise.resolve(); m.session = "two"; finish(); await pending; await rejected;
  expect(m.post).not.toHaveBeenCalled();
  await saveOrders({ accountId: 9 } as never, [order()]); expect(m.post).toHaveBeenCalledOnce();
});

test("duplicate Pending registration shares the original write and releases the record after success", async () => {
  const { runPendingPmOrderWrite, pendingPmOrderWriteBarrier } = await import("./pendingPmOrderWrites");
  let finish!: () => void;
  const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const original = runPendingPmOrderWrite(9, "0xabcd", write);
  expect(runPendingPmOrderWrite(9, "0xABCD", write)).toBe(original);
  expect(write).toHaveBeenCalledOnce(); finish(); await original;
  expect(pendingPmOrderWriteBarrier(9, [order()])).toBeUndefined();
});

test("a failed initial write rejects its waiting save and permits a new registration", async () => {
  const { runPendingPmOrderWrite, pendingPmOrderWriteBarrier } = await import("./pendingPmOrderWrites");
  let fail!: (error: Error) => void;
  const pending = runPendingPmOrderWrite(9, "0xabcd", () => new Promise<void>((_, reject) => { fail = reject; }));
  const initialRejected = expect(pending).rejects.toThrow("initial failed");
  const barrierRejected = expect(pendingPmOrderWriteBarrier(9, [order()])!()).rejects.toThrow("initial failed");
  fail(new Error("initial failed")); await initialRejected; await barrierRejected;
  await runPendingPmOrderWrite(9, "0xabcd", async () => {});
});

test("a session switch during async order projection cannot lose the original write/session guard", async () => {
  const { runPendingPmOrderWrite } = await import("./pendingPmOrderWrites");
  const { registerOrderSyncProjection, saveOrders } = await import("@/api/order");
  let finishPending!: () => void;
  let finishProjection!: (orders: VenueOrder[]) => void;
  const pending = runPendingPmOrderWrite(9, "0xabcd", () => new Promise<void>(resolve => { finishPending = resolve; }));
  const unregister = registerOrderSyncProjection(() => new Promise(resolve => { finishProjection = resolve; }));
  const terminal = saveOrders({ accountId: 9 } as never, [order()]);
  const rejected = expect(terminal).rejects.toThrow("会话已切换");
  m.session = "two"; finishPending(); await pending; finishProjection([order()]); await rejected;
  expect(m.post).not.toHaveBeenCalled(); unregister();
});
