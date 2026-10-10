import type { BetResult } from "@changmen/client-core/models/betResult";
import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { readGtcOtherOrders, settleGtcOtherLeg } from "./otherOrders";

const mocks = vi.hoisted(() => ({ getOrders: vi.fn(), save: vi.fn(), refresh: vi.fn(), outcome: vi.fn(), valid: true }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => mocks.valid }));
vi.mock("./ordersApi", () => ({ saveOrders: mocks.save, refreshGtcOrders: mocks.refresh }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mocks.getOrders }) }));

vi.mock("@/domain/betting/resolveVenueLegOutcome", () => ({ resolveVenueLegOutcome: mocks.outcome }));
function record(): GtcExecution {
  const plan = { otherPlayerId: 2, otherProvider: "RAY", otherStake: 100, otherVenueMatchId: "gtc-match", otherVenueItemId: "gtc-away", linkId: 1791558222471, shares: "10", originalPmLeg: "B" } as GtcPlan;
  const row = createGtcExecution("gtc", "owner", "wallet", "maker", plan, Date.now() - 1000);
  row.other = { state: "accepted", submittedAt: Date.now() - 1000, orderId: null, message: "" };
  return row;
}
function account() {
  const acc = new PlatformAccount({ accountId: 2, playerName: "RAY", provider: "RAY" });
  acc.balance = 500; acc.unsettle = 3; acc.winBalance = 999; acc.loadingBalance = false;
  return acc;
}
function original(): VenueOrder {
  return { provider: "RAY", orderId: "gtc-ray", createAt: Date.now(), odds: 2, betMoney: 100, money: 0, reward: 0, status: "none", game: "", match: "", bet: "", item: "", venueMatchId: "gtc-match", venueItemId: "gtc-away", link: 123 };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.valid = true; mocks.getOrders.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined); mocks.refresh.mockResolvedValue(undefined);
  mocks.outcome.mockImplementation(async (_account: unknown, _result: unknown, pull: () => Promise<VenueOrder[]>) => ({ orders: await pull(), settlement: "filled" }));
});
describe("independent GTC other-leg queries", () => {
  it("matches only the unique original and never updates account-wide FOK statistics or source objects", async () => {
    const acc = account(); const row = record(); const own = original();
    const fok = { ...original(), orderId: "fok-ray", venueMatchId: "fok-match", link: 1791559000999 };
    mocks.getOrders.mockResolvedValue([fok, own]);
    expect(await readGtcOtherOrders(acc, row)).toEqual([{ ...own, link: row.plan.linkId, pmGtcExecutionId: row.id }]);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(acc, [{ ...own, link: row.plan.linkId, pmGtcExecutionId: row.id }]);
    expect(own.link).toBe(123); expect(fok.link).toBe(1791559000999);
    expect([acc.balance, acc.unsettle, acc.winBalance, acc.loadingBalance]).toEqual([500, 3, 999, false]);
  });
  it("two matching orders remain unknown without saving either", async () => {
    mocks.getOrders.mockResolvedValue([original(), { ...original(), orderId: "second" }]);
    expect(await readGtcOtherOrders(account(), record())).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("unknown GTC submission cannot claim an identical later FOK as its original order", async () => {
    const row = record(); row.other.state = "unknown";
    mocks.getOrders.mockResolvedValue([original()]);
    expect(await readGtcOtherOrders(account(), row)).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("already-bound FOK from the same match, amount and time cannot be taken as an unbound GTC", async () => {
    mocks.getOrders.mockResolvedValue([{ ...original(), link: 1791559000999 }]);
    expect(await readGtcOtherOrders(account(), record())).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("wrong account identity prevents any venue request", async () => {
    const acc = account(); acc.accountId = 3;
    await expect(readGtcOtherOrders(acc, record())).rejects.toThrow("身份不一致");
    expect(mocks.getOrders).not.toHaveBeenCalled();
  });
  it("a changed login during venue read prevents persistence", async () => {
    mocks.getOrders.mockImplementation(async () => { mocks.valid = false; return [original()]; });
    await expect(readGtcOtherOrders(account(), record())).rejects.toThrow("会话已变更");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("first-round confirmation receives only original GTC evidence and keeps the configured wait", async () => {
    mocks.getOrders.mockResolvedValue([original(), { ...original(), orderId: "fok", venueMatchId: "different-match", status: "reject" }]);
    const acc = account(); const row = record(); const result = { provider: "RAY", success: true } as BetResult;
    expect(await settleGtcOtherLeg(acc, result, () => row, 30)).toMatchObject({ rejected: false, pendingConfirm: false, orders: [{ orderId: "gtc-ray" }] });
    expect(mocks.outcome).toHaveBeenCalledWith(acc, result, expect.any(Function), { confirmPostAccepted: false, rejectWaitSec: 30 });
    expect(mocks.save.mock.calls[0]![1]).toHaveLength(1);
  });
  it("missing original is pending even if the generic outcome reports filled or rejected", async () => {
    mocks.outcome.mockResolvedValue({ orders: [], settlement: "unfilled" });
    expect(await settleGtcOtherLeg(account(), { success: true } as BetResult, record, 30)).toEqual({ orders: [], rejected: false, pendingConfirm: true });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
