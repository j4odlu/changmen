import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveVenueSettlementLog } from "./bettingLog";

const mocks = vi.hoisted(() => ({ observe: vi.fn(), log: vi.fn(async () => true) }));
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
});
