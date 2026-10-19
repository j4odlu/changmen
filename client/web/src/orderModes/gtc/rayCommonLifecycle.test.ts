import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/client-core/contract";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { BetResult } from "@changmen/client-core/models/betResult";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { updateVenueOrders } from "@/stores/account/venueOrders";
import { settleArbLegUntilTerminal } from "@/stores/betting/autoBet/arbLegSettle";
import { registerRayOrderContext, bindRayOrderContexts } from "@/runtime/rayOrderMonitor/contexts";
import { useRayOrderContextStore } from "@/runtime/rayOrderMonitor/contextStore";
import { beginRayOrderObservation, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { readGtcOtherOrders, settleGtcOtherLeg } from "./otherOrders";

const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), dedicatedSave: vi.fn(), bind: vi.fn(), wait: vi.fn(), account: null as PlatformAccount | null }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/api/order", () => ({ saveOrders: mock.save }));
vi.mock("./ordersApi", () => ({ saveOrders: mock.dedicatedSave, refreshGtcOrders: vi.fn() }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn(async () => {}) }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait: mock.wait }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn(), bindArbOrderId: mock.bind }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", isLoggedIn: true }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ updateVenueOrders, findAccount: () => mock.account }) }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mock.read }) }));

const submittedAt = 1792083670122;
const link = 1792083669201;
const order: VenueOrder = { provider: "RAY", orderId: "ray-original", createAt: submittedAt - 1122,
  odds: 1.44, betMoney: 50, money: 0, reward: 0, status: "none", game: "", match: "PlayTime vs Skyreavers",
  bet: "r1 获胜者", item: "PlayTime", venueMatchId: "38455713", venueItemId: "76598707" };
function record(): GtcExecution {
  const row = createGtcExecution("gtc", "owner", "wallet", "maker", {
    otherPlayerId: 46, otherProvider: "RAY", otherStake: 50, otherVenueMatchId: order.venueMatchId,
    otherVenueItemId: order.venueItemId, linkId: link, shares: "10", originalPmLeg: "B",
  } as GtcPlan, submittedAt);
  row.other = { state: "accepted", submittedAt, orderId: null, message: "" };
  return row;
}
function result() {
  const value = new BetResult("RAY", true); value.beginTime = submittedAt; value.link = link; return value;
}
beforeEach(() => {
  setActivePinia(createPinia()); sessionStorage.clear(); resetRayOrderResults(); vi.clearAllMocks();
  mock.account = new PlatformAccount({ accountId: 46, provider: "RAY", playerName: "NIP" });
  mock.read.mockReset(); mock.save.mockResolvedValue(undefined); mock.bind.mockResolvedValue(true); mock.wait.mockResolvedValue(undefined);
});

it.each(["FOK", "GTC"])("%s uses the same retry, clock tolerance, complete-list save and final Link", async mode => {
  const older = { ...order, orderId: "older", createAt: submittedAt - 60000 };
  mock.read.mockResolvedValueOnce([older]).mockResolvedValueOnce([{ ...order }, older]);
  const outcome = mode === "GTC"
    ? await settleGtcOtherLeg(mock.account!, result(), record, 0)
    : await settleArbLegUntilTerminal(mock.account!, result(), { rejectWaitSec: 0, pendingBindLinkId: link });
  expect(mock.read).toHaveBeenCalledTimes(2);
  expect(mock.wait).toHaveBeenCalledWith(500);
  expect(outcome.orders[0]).toMatchObject({ orderId: order.orderId, link });
  expect(mock.save).toHaveBeenCalledExactlyOnceWith(mock.account, [{ ...order, link }, older]);
  expect(mock.dedicatedSave).not.toHaveBeenCalled();
});

it("after initial polling misses, the common monitor identifies the late order and normal sync binds it", async () => {
  mock.read.mockResolvedValue([]);
  const row = record(); const account = mock.account!;
  const initial = await settleGtcOtherLeg(account, result(), () => row, 0);
  expect(mock.read).toHaveBeenCalledTimes(5); expect(initial.orders).toEqual([]);
  registerRayOrderContext({ linkId: link, accountId: 46, side: "A", submittedAt, matchId: 1, betId: 2,
    match: order.match, bet: order.bet, item: order.item, target: "Home", odds: 1.44, betMoney: 50,
    anchorConfirmed: false, anchorProvider: "Polymarket", anchorAccountId: 292, anchorBetMoney: 0, anchorOdds: 0,
    initialOrders: initial.orders, initialRejected: false });
  const late = { ...order }; const unrelated = { ...order, orderId: "unrelated", betMoney: 150 };
  bindRayOrderContexts(account, [late, unrelated], () => true);
  beginRayOrderObservation(account)([late, unrelated]);
  expect(useRayOrderContextStore().taskForLink(link)).toMatchObject({ boundOrderId: late.orderId, monitorBound: true });
  expect(await readGtcOtherOrders(account, row)).toMatchObject([{ orderId: late.orderId, link }]);
  expect(mock.read).toHaveBeenCalledTimes(5); // PM only observes; no separate RAY poll.
  mock.read.mockResolvedValue([late, unrelated]);
  await updateVenueOrders(account); await vi.dynamicImportSettled();
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith(link, "RAY", 46, late.orderId);
  expect(mock.dedicatedSave).not.toHaveBeenCalled();
  expect(late).not.toHaveProperty("pmGtcExecutionId");
});

it("an unconfirmed context cannot let GTC claim a similar unrelated order", async () => {
  const account = mock.account!;
  beginRayOrderObservation(account)([{ ...order }]);
  expect(await readGtcOtherOrders(account, record())).toEqual([]);
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});
