import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { tryResumePendingVenueMakeUp } from "./loseOrderPmPending";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(), save: vi.fn(), settle: vi.fn(), log: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/api/order", () => ({ getPmSubmission: mocks.recover, saveOrders: mocks.save }));
vi.mock("@/domain/betting/resolveVenueLegOutcome", () => ({ resolveVenueLegOutcome: mocks.settle }));
vi.mock("@/services/bettingLog", () => ({ saveVenueSettlementLog: mocks.log }));
vi.mock("@/shared/a8Notify", () => ({ a8Tip: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ config: { makeUp: false } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ refreshBalance: mocks.refresh, updateVenueOrders: vi.fn() }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ loseOrderMessage: vi.fn() }) }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetFail: vi.fn(), syncActiveBetMakeupDone: vi.fn(),
  syncActiveBetMakeupPendingConfirm: vi.fn(), syncActiveBetMakeupRejected: vi.fn(),
}));
vi.mock("@/stores/betting/arbOrderBind", () => ({
  bindArbLegOrder: vi.fn(async () => true), refreshOrderListAfterBind: vi.fn(), resolveArbBindOrderId: vi.fn(),
}));
vi.mock("@/stores/betting/pendingOrderBind", () => ({ enqueuePendingOrderBind: vi.fn() }));

const id = `0x${"9".repeat(64)}`;
const snapshot = pmSubmissionFromResult({
  orderId: id, beginTime: 1790697330729,
  request: { order: { side: "BUY", makerAmount: "14930000" } },
}, 317)!;
function legacy() {
  return new LoseOrder({ betId: 1, linkId: 1790697330150, betMoney: 79, betOdds: 2.35,
    pendingVenueOrderId: id, pendingVenueAccountId: 317, pendingVenueBetMoney: 118,
    pendingVenueOdds: 1.571, createAt: 1790697382798 });
}
async function resume(order: LoseOrder) {
  const persist = vi.fn();
  await tryResumePendingVenueMakeUp({
    betId: 1, order,
    accountStore: { findAccount: () => ({ accountId: 317, provider: "Polymarket" }) } as never,
    loseStore: { persist, clearPendingVenueOrder: vi.fn(), setPendingVenueOrder: vi.fn(), deferPendingVenueOrder: vi.fn() } as never,
    removeIds: new Set(), setMessage: vi.fn(), markSuccess: vi.fn(),
  });
  return persist;
}

describe("PM original submission recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recover.mockResolvedValue(null);
    mocks.save.mockResolvedValue(undefined);
    mocks.settle.mockResolvedValue({ settlement: "unfilled", orders: [] });
  });

  it("recovers legacy 118 CNY from the original POST and saves about 100 CNY", async () => {
    mocks.recover.mockResolvedValue(snapshot);
    const order = legacy();
    const persist = await resume(order);
    expect(persist).toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][1][0]).toMatchObject({ pmStakeUsdc: 14.93, createAt: snapshot.submittedAt });
    expect(mocks.save.mock.calls[0][1][0].betMoney).toBeCloseTo(100.031);
    expect(order.pendingPmSubmission).toEqual(snapshot);
  });

  it("restored original snapshot survives price/plan changes and repeated confirmation", async () => {
    const order = new LoseOrder({ ...legacy().toJSON(), pendingPmSubmission: snapshot });
    order.betMoney = 999;
    order.betOdds = 12;
    await resume(order);
    await resume(new LoseOrder(order.toJSON()));
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    for (const call of mocks.save.mock.calls)
      expect(call[1][0].betMoney).toBeCloseTo(100.031);
  });

  it.each(["missing", "network", "wrong-account", "wrong-order"])("%s evidence never writes inferred 118/791", async (kind) => {
    if (kind === "network") mocks.recover.mockRejectedValue(new Error("offline"));
    if (kind === "wrong-account") mocks.recover.mockResolvedValue({ ...snapshot, accountId: 1 });
    if (kind === "wrong-order") mocks.recover.mockResolvedValue({ ...snapshot, orderId: "other" });
    await resume(legacy());
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("retains the original order after a read failure and completes after recovery", async () => {
    const order = legacy();
    await resume(order);
    expect(order.pendingVenueOrderId).toBe(id);
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.recover.mockResolvedValue(snapshot);
    await resume(order);
    expect(mocks.save.mock.calls[0][1][0].betMoney).toBeCloseTo(100.031);
  });
});
