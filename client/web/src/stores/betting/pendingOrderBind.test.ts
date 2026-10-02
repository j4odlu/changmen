import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingOrderBinds,
  enqueuePendingOrderBind,
  peekPendingOrderBinds,
  processPendingOrderBinds,
} from "./pendingOrderBind";

const saveOrderBind = vi.hoisted(() => vi.fn());
const refreshOrderListAfterBind = vi.hoisted(() => vi.fn());
const syncActiveBetBindFailed = vi.hoisted(() => vi.fn());
const syncActiveBetBindSuccess = vi.hoisted(() => vi.fn());
const findAccount = vi.hoisted(() => vi.fn());
const observeOrder = vi.hoisted(() => vi.fn());
vi.mock("@/services/orderObservation", () => ({ observeOrder }));

vi.mock("@/api/esport", () => ({ saveOrderBind }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetBindFailed,
  syncActiveBetBindSuccess,
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ findAccount }),
}));

describe("pendingOrderBind", () => {
  beforeEach(() => {
    clearPendingOrderBinds();
    saveOrderBind.mockReset();
    refreshOrderListAfterBind.mockReset();
    syncActiveBetBindFailed.mockReset();
    syncActiveBetBindSuccess.mockReset();
    findAccount.mockReset();
    observeOrder.mockReset();
    findAccount.mockReturnValue({ accountId: 7 });
  });

  it("dedupes same link+provider+orderId", () => {
    enqueuePendingOrderBind({
      linkId: 1_700,
      provider: "OB",
      accountId: 7,
      orderId: "o1",
      betId: 1,
      side: "A",
    });
    enqueuePendingOrderBind({
      linkId: 1_700,
      provider: "OB",
      accountId: 7,
      orderId: "o1",
      betId: 1,
      side: "A",
    });
    expect(peekPendingOrderBinds()).toHaveLength(1);
  });

  it("retries on next process until success", async () => {
    enqueuePendingOrderBind({
      linkId: 1_700_000_000_000,
      provider: "OB",
      accountId: 7,
      orderId: "o1",
      betId: 9,
      side: "A",
    });
    saveOrderBind.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const first = await processPendingOrderBinds();
    expect(first).toEqual({ ok: 0, fail: 0, left: 1 });
    expect(refreshOrderListAfterBind).not.toHaveBeenCalled();

    const second = await processPendingOrderBinds();
    expect(second).toEqual({ ok: 1, fail: 0, left: 0 });
    expect(refreshOrderListAfterBind).toHaveBeenCalledOnce();
    expect(syncActiveBetBindSuccess).toHaveBeenCalledWith(9, ["A"], "已绑单");
    expect(syncActiveBetBindFailed).not.toHaveBeenCalled();
  });

  it("marks active bet after deferred attempts exhausted", async () => {
    enqueuePendingOrderBind({
      linkId: 1_700_000_000_000,
      provider: "RAY",
      accountId: 8,
      orderId: "r1",
      betId: 11,
      side: "B",
    });
    saveOrderBind.mockResolvedValue(false);

    for (let i = 0; i < 5; i += 1)
      await processPendingOrderBinds();

    expect(peekPendingOrderBinds()).toHaveLength(0);
    expect(syncActiveBetBindFailed).toHaveBeenCalledWith(
      11,
      ["B"],
      expect.stringContaining("补绑耗尽"),
    );
  });

  it("records the original attempt's deferred success without increasing bind calls", async () => {
    const observation = { ownerUserId: "u1", attemptId: "attempt-1", sequence: 5 };
    enqueuePendingOrderBind({ linkId: 1700, provider: "OB", accountId: 7, orderId: "o1", betId: 9, side: "A", target: "Home", observation });
    saveOrderBind.mockResolvedValue(true);
    expect(await processPendingOrderBinds()).toEqual({ ok: 1, fail: 0, left: 0 });
    expect(saveOrderBind).toHaveBeenCalledTimes(1);
    expect(observeOrder).toHaveBeenCalledWith(observation, 1700, "bind_result", expect.objectContaining({ orderId: "o1", target: "Home", outcome: "saved" }));
  });

  it("keeps successful business callbacks when observation fails", async () => {
    enqueuePendingOrderBind({ linkId: 1700, provider: "OB", accountId: 7, orderId: "o1", betId: 9, side: "A" });
    observeOrder.mockImplementation(() => { throw new Error("observer failure"); });
    saveOrderBind.mockResolvedValue(true);
    expect(await processPendingOrderBinds()).toEqual({ ok: 1, fail: 0, left: 0 });
    expect(saveOrderBind).toHaveBeenCalledTimes(1);
    expect(syncActiveBetBindSuccess).toHaveBeenCalledWith(9, ["A"], "已绑单");
    expect(refreshOrderListAfterBind).toHaveBeenCalledOnce();
  });
});
