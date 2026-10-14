import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { getProvider } from "@/runtime/providers";
import { processA8RegularVenueMakeUpLeg } from "@/stores/betting/loseOrderRegular";
import { readRayAccountOrders, resetRayOrderPolling } from "./ray";

const mocks = vi.hoisted(() => ({ read: vi.fn(), wait: vi.fn(), rejected: vi.fn(), done: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/runtime/venueAdapters", async () => {
  const { withA8ResolveLegOutcome } = await import("@changmen/venue-adapter/adaptation");
  return { getProvider: () => withA8ResolveLegOutcome({ getOrders: mocks.read, checkBet: vi.fn(), betting: vi.fn() }) };
});
vi.mock("@changmen/venue-adapter/shared/rejectWait", () => ({ venueRejectWaitBeforePoll: mocks.wait }));
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
beforeEach(() => { resetRayOrderPolling(); vi.clearAllMocks(); mocks.wait.mockResolvedValue(undefined); });

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
  const confirmation = processA8RegularVenueMakeUpLeg({
    betId: 71,
    order: { target: "Home", linkId: 1791558222471, isCreateOrder: false } as Params["order"],
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
});
