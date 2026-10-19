import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/client-core/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { LoseOrder } from "@/models/loseOrder";
import { getProvider } from "@/runtime/providers";
import { updateVenueOrders } from "@/stores/account/venueOrders";
import { processA8RegularVenueMakeUpLeg } from "@/stores/betting/loseOrderRegular";
import { settleArbLeg } from "@/stores/betting/autoBet/arbLegSettle";
import { readRayAccountOrders, resetRayOrderPolling } from "./ray";

const mocks = vi.hoisted(() => ({ read: vi.fn(), wait: vi.fn(), rejected: vi.fn(), done: vi.fn(), save: vi.fn(), consume: vi.fn() }));
const makeupOrders = vi.hoisted(() => new Map());
vi.mock("@/stores/loseOrderStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/stores/loseOrderStore")>(),
  useLoseOrderStore: () => ({ orders: makeupOrders, clearPendingVenueOrder: vi.fn(), persist: vi.fn(), consumeOrder: mocks.consume }),
}));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ updateVenueOrders }) }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/runtime/venueAdapters", async () => {
  const { withA8ResolveLegOutcome } = await import("@changmen/venue-browser/adapter/adaptation");
  return { getProvider: () => withA8ResolveLegOutcome({ getOrders: mocks.read, checkBet: vi.fn(), betting: vi.fn() }) };
});
vi.mock("@changmen/venue-browser/adapter/shared/rejectWait", () => ({ venueRejectWaitBeforePoll: mocks.wait }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/services/bettingLog", () => ({ saveVenueSettlementLog: vi.fn() }));
vi.mock("@/shared/a8Notify", () => ({ a8Tip: vi.fn() }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetMakeupSettling: vi.fn(), syncActiveBetMakeupRejected: mocks.rejected, syncActiveBetMakeupDone: mocks.done,
}));
vi.mock("@/stores/betting/arbOrderBind", () => ({
  bindArbLegOrder: vi.fn().mockResolvedValue(true), refreshOrderListAfterBind: vi.fn(), resolveArbBindOrderId: vi.fn(),
}));
vi.mock("@/stores/betting/pendingOrderBind", () => ({ enqueuePendingOrderBind: vi.fn() }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: vi.fn() }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ loseOrderMessage: vi.fn() }) }));

const venueOrder = (orderId: string, status: VenueOrder["status"]): VenueOrder => ({
  provider: "RAY", orderId, status, createAt: 1, odds: 2, betMoney: 100,
  money: 0, reward: 0, game: "", match: "", bet: "", item: "",
});
beforeEach(() => {
  resetRayOrderPolling(); makeupOrders.clear(); vi.clearAllMocks(); mocks.wait.mockResolvedValue(undefined);
  mocks.save.mockReset(); mocks.save.mockResolvedValue(undefined);
  mocks.consume.mockImplementation((order: LoseOrder) => { makeupOrders.delete(order.betId); });
});

it("a rejected inactive-account makeup stays queued even while an older RAY monitor query is pending", async () => {
  const account = new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" });
  account.active = false;
  let release!: (orders: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise<VenueOrder[]>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce([venueOrder("new-rejected", "reject")]);
  const background = readRayAccountOrders(account);
  await Promise.resolve(); await Promise.resolve();
  const removeIds = new Set<number>();
  type Params = Parameters<typeof processA8RegularVenueMakeUpLeg>[0];
  const order = { target: "Home", linkId: 1791558222471, isCreateOrder: false } as Params["order"];
  makeupOrders.set(71, order);
  const confirmation = processA8RegularVenueMakeUpLeg({
    betId: 71,
    order,
    bet: { id: 71 } as Params["bet"],
    account,
    checked: new BetOption("RAY", "match", "bet", "item", 100, "Home", 2),
    result: { provider: "RAY", success: true, orderId: "new-rejected" } as BetResult,
    waitSec: 30,
    accountStore: { updateVenueOrders: (acc: PlatformAccount) => getProvider(acc)!.getOrders!(acc) } as unknown as Params["accountStore"],
    removeIds,
    setMessage: vi.fn(),
  });
  await Promise.resolve(); await Promise.resolve();
  release([venueOrder("old-accepted", "none")]);
  await confirmation; await background;
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.wait).toHaveBeenCalledWith(30);
  expect(mocks.rejected).toHaveBeenCalledWith(71, "Home");
  expect(mocks.done).not.toHaveBeenCalled();
  expect(removeIds.has(71)).toBe(false);
  expect(makeupOrders.get(71)).toBe(order);
});

it.each((["OB", "RAY"] as const).flatMap(provider =>
  (["reject", "none"] as const).flatMap(status =>
    [false, true].map(saveFails => ({ provider, status, saveFails })))))(
  "$provider/$status/saveFails=$saveFails uses the real order-sync result for makeup confirmation",
  async ({ provider, status, saveFails }) => {
    const account = new PlatformAccount({ accountId: 2, provider, playerName: "test", token: "esport-token" });
    const order = new LoseOrder({ betId: 71, target: "Home", linkId: 1791558222471, isCreateOrder: false });
    makeupOrders.set(71, order);
    mocks.read.mockResolvedValue([{ ...venueOrder("original", status), provider }]);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    if (saveFails) mocks.save.mockRejectedValue(new Error("backend save unavailable"));
    try {
      type Params = Parameters<typeof processA8RegularVenueMakeUpLeg>[0];
      await processA8RegularVenueMakeUpLeg({
        betId: 71, order, bet: { id: 71 }, account,
        checked: new BetOption(provider, "match", "bet", "item", 100, "Home", 2),
        result: { provider, success: true, orderId: "original" } as BetResult,
        waitSec: 30,
        accountStore: { updateVenueOrders } as unknown as Params["accountStore"],
        removeIds: new Set(), setMessage: vi.fn(),
      });
      expect(mocks.wait).toHaveBeenCalledExactlyOnceWith(30);
      expect(mocks.read).toHaveBeenCalledExactlyOnceWith(account);
      expect(mocks.save).toHaveBeenCalledOnce();
      expect(mocks.rejected).toHaveBeenCalledTimes(status === "reject" ? 1 : 0);
      expect(mocks.done).toHaveBeenCalledTimes(status === "none" ? 1 : 0);
      expect(mocks.consume).toHaveBeenCalledTimes(status === "none" ? 1 : 0);
      expect(makeupOrders.has(71)).toBe(status === "reject");
    }
    finally { report.mockRestore(); }
  },
);

it.each((["OB", "RAY"] as const).flatMap(provider =>
  (["reject", "none"] as const).map(status => ({ provider, status }))))(
  "$provider/$status keeps the original arbitrage leg result when backend save fails",
  async ({ provider, status }) => {
    const account = new PlatformAccount({ accountId: 2, provider, playerName: "test", token: "esport-token" });
    mocks.read.mockResolvedValue([{ ...venueOrder("original", status), provider }]);
    mocks.save.mockRejectedValue(new Error("backend save unavailable"));
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const settled = await settleArbLeg(account, { provider, success: true, orderId: "original" } as BetResult,
        { rejectWaitSec: 30, pendingBindLinkId: 1791558222471 });
      expect(settled).toMatchObject({ rejected: status === "reject", pendingConfirm: false });
      expect(settled.orders).toEqual([expect.objectContaining({ orderId: "original", status, link: 1791558222471 })]);
      expect(mocks.read).toHaveBeenCalledOnce();
      expect(mocks.save).toHaveBeenCalledOnce();
    }
    finally { report.mockRestore(); }
  },
);
