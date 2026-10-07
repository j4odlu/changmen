import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveVenueSettlementLog } from "./bettingLog";

const mocks = vi.hoisted(() => ({ observe: vi.fn(), log: vi.fn(async (_title: string, _data: unknown) => true) }));
vi.mock("./orderObservation", () => ({ observeOption: mocks.observe }));
vi.mock("@/api/chat", () => ({ saveUserLog: mocks.log }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ getPlatformName: () => "OB" }) }));

describe("结算观察的证据边界", () => {
  beforeEach(() => { mocks.observe.mockReset(); mocks.log.mockClear(); });
  const account = { provider: "OB", accountId: 1, playerName: "p" } as PlatformAccount;
  const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);

  it("retains a rule result without claiming the unrelated latest order confirms it", () => {
    const result = new BetResult("OB", true);
    result.orderId = "expected";
    const orders = [{ orderId: "another", status: "win" }] as VenueOrder[];
    saveVenueSettlementLog({ account, option, result, orders, settlement: "filled" });
    expect(mocks.observe).toHaveBeenCalledWith(option, account, "settlement_observed", expect.objectContaining({ source: "orchestration_result", observedStatus: undefined }));
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("keeps policy rejection separate even when a synthetic rejected order is present", () => {
    const result = new BetResult("OB", false, "超时策略判拒");
    result.orderId = "expected";
    saveVenueSettlementLog({ account, option, result, orders: [{ orderId: "expected", status: "reject" }] as VenueOrder[], settlement: "unfilled" });
    expect(mocks.observe).toHaveBeenCalledWith(option, account, "settlement_observed", expect.objectContaining({ source: "timeout_policy" }));
  });

  it("preserves existing logging when the observation hook fails", () => {
    mocks.observe.mockImplementation(() => { throw new Error("observer failure"); });
    saveVenueSettlementLog({ account, option, result: new BetResult("OB", true), orders: [], settlement: "filled" });
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });
  it("records the RAY rejection and reason even when its POST did not return an order ID", () => {
    const ray = { ...account, provider: "RAY" } as PlatformAccount;
    const option = new BetOption("RAY", "38450996", "18304", "76390520", 100, "Home", 1.4);
    const result = Object.assign(new BetResult("RAY", true), { beginTime: 1791393169828 });
    const order = { provider: "RAY", orderId: "406855f4d96e6acdb1ee", status: "reject", venueMatchId: "38450996", venueItemId: "76390520",
      createAt: 1791393170000, betMoney: 100, odds: 1.4, venueRejectReason: "系统拒绝" } as VenueOrder;
    saveVenueSettlementLog({ account: ray, option, result, orders: [order], settlement: "unfilled" });
    expect(mocks.observe).toHaveBeenCalledWith(option, ray, "settlement_observed", expect.objectContaining({
      orderId: order.orderId, outcome: "unfilled", observedStatus: "reject", source: "adapter", phase: "reject_detection", safeSummary: "RAY 拒单原因：系统拒绝",
    }));
    expect(result.orderId).toBeNull();
    expect(result.success).toBe(true);
    order.venueRejectReason = "token=SECRET";
    mocks.observe.mockClear();
    saveVenueSettlementLog({ account: ray, option, result, orders: [order], settlement: "unfilled" });
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("SECRET");
  });
  it.each(["matched", "delayed"])("records the PM %s phase correctly even after pending is cleared", status => {
    const pm = { ...account, provider: "Polymarket" } as PlatformAccount;
    const result = new BetResult("Polymarket", true, "", undefined, { status });
    result.orderId = "pm-1";
    saveVenueSettlementLog({ account: pm, option, result, orders: [{ orderId: "pm-1", status: "none" }] as VenueOrder[], settlement: "filled" });
    expect(mocks.observe).toHaveBeenCalledWith(option, pm, "settlement_observed", expect.objectContaining({ phase: status === "matched" ? "direct_fill" : "reject_detection" }));
    expect(mocks.log.mock.calls[0]?.[0]).toContain("拒单检测 =>");
  });
  it("does not drop the legacy settlement log if the new evidence lookup throws", () => {
    const ray = { ...account, provider: "RAY" } as PlatformAccount;
    const option = new BetOption("RAY", "m", "b", "i", 100, "Home", 2);
    Object.defineProperty(option, "matchId", { get() { throw new Error("evidence lookup failure"); } });
    const result = new BetResult("RAY", true);
    const order = { provider: "RAY", orderId: "r1", createAt: Date.now(), status: "reject" } as VenueOrder;
    expect(() => saveVenueSettlementLog({ account: ray, option, result, orders: [order], settlement: "unfilled" })).not.toThrow();
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
