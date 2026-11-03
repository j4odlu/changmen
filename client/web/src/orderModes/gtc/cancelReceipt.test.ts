import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, expect, it, vi } from "vitest";
import { waitForGtcCancelReceipt } from "./cancelReceipt";

const ws = vi.hoisted(() => ({ observe: vi.fn(), read: vi.fn(), dispose: vi.fn(), update: () => {} }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  observePolymarketOrderWatch: ws.observe, readPolymarketOrderWatch: ws.read,
}));
const account = { accountId: 1, provider: "Polymarket", token: "original-account" } as PlatformAccount;
const orderId = "original-order";
beforeEach(() => {
  vi.clearAllMocks(); ws.read.mockReturnValue(null);
  ws.observe.mockImplementation((_account, _id, update) => { ws.update = update; return ws.dispose; });
});

it("accepts an exact HTTP cancellation receipt without waiting for the websocket", async () => {
  const send = vi.fn(async () => ({ canceled: [orderId] }));
  expect(await waitForGtcCancelReceipt(account, orderId, send, () => true)).toEqual({ canceled: [orderId] });
  expect(ws.observe.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  expect(ws.dispose).toHaveBeenCalledOnce();
});

it.each(["CANCELED", "cancelled"])("accepts scoped %s WS evidence while HTTP is stalled and absorbs its late rejection", async status => {
  let reject!: (error: Error) => void;
  const send = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
  const task = waitForGtcCancelReceipt(account, orderId, send, () => true);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  ws.read.mockReturnValue({ row: { status, size_matched: "3" }, outcome: "matched" }); ws.update();
  expect(await task).toEqual({ canceled: [orderId] });
  expect(ws.read).toHaveBeenCalledWith(orderId, account); expect(ws.dispose).toHaveBeenCalledOnce();
  reject(new Error("late transport failure")); await Promise.resolve();
});

it("does not resend an order already confirmed canceled by the scoped WS cache", async () => {
  ws.read.mockReturnValue({ row: { status: "CANCELED" } }); const send = vi.fn();
  expect(await waitForGtcCancelReceipt(account, orderId, send, () => true)).toEqual({ canceled: [orderId] });
  expect(send).not.toHaveBeenCalled(); expect(ws.dispose).toHaveBeenCalledOnce();
});

it("does not mistake a fill or a failed trade for cancellation", async () => {
  let finish!: (receipt: { not_canceled: Record<string, string> }) => void;
  const send = vi.fn(() => new Promise<{ not_canceled: Record<string, string> }>(resolve => { finish = resolve; }));
  const task = waitForGtcCancelReceipt(account, orderId, send, () => true);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  for (const status of ["MATCHED", "CONFIRMED", "FAILED", "LIVE"]) {
    ws.read.mockReturnValue({ row: { status }, outcome: "unfilled" }); ws.update();
  }
  finish({ not_canceled: { [orderId]: "already matched" } });
  expect(await task).toEqual({ not_canceled: { [orderId]: "already matched" } });
});

it("falls back to HTTP if websocket subscription is unavailable", async () => {
  ws.observe.mockImplementationOnce(() => { throw new Error("WS offline"); });
  const send = vi.fn(async () => ({ canceled: [orderId] }));
  expect(await waitForGtcCancelReceipt(account, orderId, send, () => true)).toEqual({ canceled: [orderId] });
});

it("propagates transport uncertainty and releases its listener", async () => {
  await expect(waitForGtcCancelReceipt(account, orderId, async () => { throw new Error("timeout"); }, () => true)).rejects.toThrow("timeout");
  expect(ws.dispose).toHaveBeenCalledOnce();
});

it("blocks sending after a session or account change", async () => {
  const send = vi.fn();
  await expect(waitForGtcCancelReceipt(account, orderId, send, () => false)).rejects.toThrow("账号已变更");
  expect(send).not.toHaveBeenCalled(); expect(ws.observe).not.toHaveBeenCalled();
});
