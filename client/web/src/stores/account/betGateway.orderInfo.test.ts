import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betting: vi.fn(), resolve: vi.fn(), save: vi.fn(), publish: vi.fn(), mark: vi.fn(),
  recover: vi.fn(), pending: vi.fn(),
}));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ betting: mocks.betting }) }));
vi.mock("@/domain/betting/resolveVenueLegOutcome", () => ({ resolveVenueLegOutcome: mocks.resolve }));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save, getPmSubmission: mocks.recover, getPendingPmOrders: mocks.pending }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session-one", isAuthSessionCurrent: () => true }));
vi.mock("@changmen/venue-browser/adapter/polymarket", async () => {
  const { buildPolymarketExecutionRejectVenueOrder, isPolymarketPostedApiFailure } = await import("@changmen/venue-browser/polymarket/orders/facts/orderStatus");
  return { buildPolymarketExecutionRejectVenueOrder, isPolymarketPostedApiFailure,
    pmSubmitScope: () => "owner-wallet", pmAccountSubmitAttempts: () => [],
    pmSubmitMaker: () => "0x1111111111111111111111111111111111111111" };
});
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ updateVenueOrders: vi.fn() }) }));
vi.mock("@/stores/account/balanceRefresh", () => ({ refreshAccountBalance: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner" }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ delayMessage: vi.fn() }) }));
vi.mock("@/services/orderObservation", () => ({ createObservationContext: vi.fn(), observeOption: vi.fn() }));
vi.mock("@/services/orderObservationEvidence", () => ({ observationFailureEvidence: vi.fn() }));
vi.mock("@/realtime/publishBetting", () => ({ publishBettingEvent: mocks.publish }));
vi.mock("@/shared/orderSound", () => ({ playOrderSuccessSound: vi.fn() }));
vi.mock("@/shared/betNotification", () => ({ startBetNotification: () => ({ close: vi.fn() }), showBetResultNotification: vi.fn() }));

const account = { accountId: 292, provider: "Polymarket", playerName: "f43e" } as PlatformAccount;
const store = { accounts: [account], findAccount: () => account, getPlatformName: () => "PM" } as unknown as AccountStoreContext;
const at = 1_792_686_326_358;
const orderId = `0x${"5b".repeat(32)}`;
const context = { game: "Dota2", match: "Team Liquid vs 1w Team", bet: "[地图2] 获胜", item: "Team Liquid" };
function option() {
  const o = new BetOption("Polymarket", "1203867", "condition", "token", 14.93, "Home", 1.515);
  o.match = { title: context.match, game: context.game } as never;
  o.bet = { id: 20, homeName: "Team Liquid", awayName: "1w Team", getBetName: () => context.bet } as never;
  o.data = { prepared: true };
  return o;
}
function accepted() {
  const result = Object.assign(new BetResult("Polymarket", true), {
    orderId, pending: true, pmSubmittedAt: at, beginTime: at,
    request: { order: { side: "BUY", makerAmount: "14930000", takerAmount: "22621200", maker: "0x1111111111111111111111111111111111111111" } },
    response: { orderID: orderId, status: "delayed", success: true },
  });
  result.saveLog = vi.fn();
  return result;
}
const taskRows = () => JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM") || "[]");
const unfilled = { settlement: "unfilled", orders: [] };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(at); sessionStorage.clear();
  mocks.pending.mockResolvedValue([]);
  mocks.save.mockResolvedValue(undefined); mocks.publish.mockResolvedValue(undefined);
  mocks.betting.mockResolvedValue(accepted()); mocks.resolve.mockResolvedValue(unfilled);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("Pending is the same stored order throughout confirmation", () => {
  it("starts manual confirmation immediately but waits for the complete order write before saving a rejection", async () => {
    let finish!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { placeBet } = await import("./betGateway");
    const result = await placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(result.orderId).toBe(orderId);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(taskRows()).toHaveLength(1);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save.mock.calls[1]![1][0]).toMatchObject({ orderId, status: "reject" });
    expect(taskRows()).toEqual([]);
  });

  it("keeps retrying the complete order before saving its terminal result through an extended database outage", async () => {
    mocks.save.mockRejectedValueOnce(new Error("offline 1"))
      .mockRejectedValueOnce(new Error("offline 2")).mockRejectedValueOnce(new Error("offline 3"));
    const { placeBet } = await import("./betGateway");
    const placed = placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(4000);
    await placed;
    expect(mocks.save.mock.calls[3]![1][0]).toMatchObject({ status: "pending", ...context });
    expect(mocks.save.mock.calls[4]![1][0]).toMatchObject({ orderId, status: "reject" });
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(taskRows()).toEqual([]);
  });

  it("returns the accepted automatic leg while its Pending database write is still in flight", async () => {
    let finish!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { placeBet } = await import("./betGateway");
    const input = option(); input.deferPostAcceptSettlement = true;
    let receipt: BetResult | undefined;
    const placed = placeBet(store, account, input, 0, { requirePreparedQuote: true }).then(result => { receipt = result; });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(receipt?.orderId).toBe(orderId);
    expect(mocks.resolve).not.toHaveBeenCalled();
    finish(); await placed;
    expect(mocks.betting).toHaveBeenCalledOnce();
  });

  it("saves the complete Pending order before checking and submits only once", async () => {
    let finish!: (value: typeof unfilled) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { placeBet } = await import("./betGateway");
    const input = option();
    const result = await placeBet(store, account, input, 0, { requirePreparedQuote: true });
    expect(result.orderId).toBe(orderId);
    expect(mocks.save.mock.calls[0]![1][0]).toMatchObject({ ...context, orderId, status: "pending",
      betMoney: 100.031, money: 0, reward: 0, pmConditionId: "condition", pmTokenId: "token",
      pmSubmission: { makerAmount: "14930000", submittedAt: at } });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.resolve.mock.invocationCallOrder[0]!);
    expect(mocks.save.mock.calls[0]![1][0]).not.toHaveProperty("pmShares");
    expect(taskRows()[0]).not.toHaveProperty("orderDisplay");
    expect(sessionStorage.getItem("PM_PENDING_ORDER_INFO")).toBeNull();
    expect(mocks.mark).not.toHaveBeenCalled();
    input.match!.title = "a later page update";
    finish(unfilled);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1]![1][0]).toMatchObject({ orderId, status: "reject", pmStakeUsdc: 14.93 });
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(taskRows()).toEqual([]);
  });

  it("reload recovers the order from RDS with all browser task/cache state absent", async () => {
    mocks.resolve.mockResolvedValueOnce({ settlement: "timeout", orders: [] });
    const { placeBet } = await import("./betGateway");
    await placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(0);
    const stored = mocks.save.mock.calls[0]![1][0];
    vi.clearAllTimers(); vi.resetModules(); sessionStorage.clear();
    mocks.pending.mockResolvedValue([{ orderId, submission: stored.pmSubmission, matchId: "1203867",
      conditionId: "condition", tokenId: "token", target: "Home", odds: 1.515, linkId: at }]);
    const { resumePendingVenueConfirmations } = await import("./betGateway");
    resumePendingVenueConfirmations(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pending).toHaveBeenCalledWith(292);
    expect(mocks.resolve.mock.calls[1]![1]).toMatchObject({ orderId,
      request: { order: { makerAmount: "14930000" } } });
    expect(mocks.save.mock.calls[1]![1][0]).toMatchObject({ orderId, status: "reject", betMoney: 100.031 });
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(taskRows()).toEqual([]);
  });

  it("keeps the Pending order through timeout and counts success only on a real fill", async () => {
    mocks.resolve.mockResolvedValueOnce({ settlement: "timeout", orders: [] });
    const { placeBet } = await import("./betGateway");
    await placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.mark).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({ settlement: "filled", orders: [{ orderId, status: "none", pmShares: 22.6 }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith(account, 20, "Home", 1.515);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1]![1][0]).toMatchObject({ orderId, status: "none", pmShares: 22.6 });
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(taskRows()).toEqual([]);
  });

  it("retries saving the same rejection without resubmitting", async () => {
    mocks.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("save unavailable"));
    const { placeBet } = await import("./betGateway");
    await placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(taskRows()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[2]![1][0]).toMatchObject({ orderId, status: "reject", betMoney: 100.031 });
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(taskRows()).toEqual([]);
  });

  it("retries only the same Pending database write on a transient save error", async () => {
    mocks.save.mockRejectedValueOnce(new Error("temporary save failure"));
    mocks.resolve.mockResolvedValue({ settlement: "timeout", orders: [] });
    const { placeBet } = await import("./betGateway");
    const placed = placeBet(store, account, option(), 0, { requirePreparedQuote: true });
    await vi.advanceTimersByTimeAsync(500);
    await placed;
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[0]![1]).toEqual(mocks.save.mock.calls[1]![1]);
    expect(mocks.save.mock.calls[1]![1][0]).toMatchObject({ orderId, status: "pending", ...context });
    expect(mocks.betting).toHaveBeenCalledOnce();
  });

  it("does not recover a stored order belonging to another maker", async () => {
    mocks.pending.mockResolvedValue([{ orderId, submission: { orderId, accountId: 292,
      makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: at,
      makerAddress: "0x2222222222222222222222222222222222222222" } }]);
    const { resumePendingVenueConfirmations } = await import("./betGateway");
    resumePendingVenueConfirmations(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
