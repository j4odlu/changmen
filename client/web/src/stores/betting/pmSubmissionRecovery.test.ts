import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { applyVenueJbSettlementOutcome, tryResumePendingVenueMakeUp } from "./loseOrderPmPending";
import { bindArbLegOrder } from "./arbOrderBind";

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
    loseStore: { orders: new Map([[1, order]]), persist, clearPendingVenueOrder: vi.fn(), setPendingVenueOrder: vi.fn(), deferPendingVenueOrder: vi.fn() } as never,
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

  it("queue replacement during original amount recovery does not discard its settlement or binding", async () => {
    const order = legacy();
    const orders = new Map([[1, order]]);
    const replacement = new LoseOrder({ betId: 1, linkId: 2, betMoney: 80, betOdds: 3, betCount: 3 });
    let recover!: (value: typeof snapshot) => void;
    mocks.recover.mockImplementationOnce(() => new Promise(resolve => { recover = resolve; }));
    const clear = vi.fn();
    const mark = vi.fn();
    const task = tryResumePendingVenueMakeUp({
      betId: 1, order,
      accountStore: { findAccount: () => ({ accountId: 317, provider: "Polymarket" }) } as never,
      loseStore: { orders, persist: vi.fn(), clearPendingVenueOrder: clear } as never,
      removeIds: new Set(), setMessage: vi.fn(), markSuccess: mark,
    });
    orders.set(1, replacement);
    recover(snapshot);
    await task;

    expect(mocks.settle).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][1][0].betMoney).toBeCloseTo(100.031);
    expect(bindArbLegOrder).toHaveBeenCalledOnce();
    expect(orders.get(1)).toBe(replacement);
    expect(replacement.betCount).toBe(3);
    expect(clear).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ accountId: 317 }), "Home");
  });

  it.each([
    { role: "target", settlement: "filled", count: 1 },
    { role: "target", settlement: "unfilled", count: 1 },
    { role: "anchor", settlement: "filled", count: 1 },
    { role: "anchor", settlement: "unfilled", count: 0 },
  ] as const)("$role/$settlement 原单重复收尾按 A8 角色只计数 $count 次", async ({ role, settlement, count }) => {
    const order = legacy();
    order.pendingVenueRole = role;
    order.pendingVenueTarget = "Away";
    const result = Object.assign(new BetResult("Polymarket", true), { orderId: id, beginTime: snapshot.submittedAt });
    const mark = vi.fn();
    // 原队列已被取消；收尾只能记原账号和原方向，不能依赖当前队列。
    const ctx = {
      betId: 1, order, result,
      account: { accountId: 317, provider: "Polymarket" } as never,
      checked: new BetOption("Polymarket", "1", "1", "", 14.93, "Away", 2),
      platformLabel: "Polymarket", loseStore: { orders: new Map() } as never,
      removeIds: new Set<number>(), setMessage: vi.fn(), markSuccess: mark,
    };
    mocks.settle.mockResolvedValue({ settlement, orders: [] });
    await applyVenueJbSettlementOutcome(ctx);
    await applyVenueJbSettlementOutcome(ctx);
    expect(mark).toHaveBeenCalledTimes(count);
    if (count)
      expect(mark).toHaveBeenCalledWith(ctx.account, "Away");
  });
});
