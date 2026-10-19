import type { VenueOrder } from "@changmen/client-core/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";

const getOrders = vi.fn();
const updateVenueOrders = vi.fn();
const refreshOrderListAfterBind = vi.fn();

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn(async () => {}),
}));

vi.mock("@/runtime/providers", () => ({
  getProvider: () => ({ getOrders }),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ updateVenueOrders }),
}));

vi.mock("@/stores/betting/arbOrderBind", () => ({
  refreshOrderListAfterBind: () => refreshOrderListAfterBind(),
}));

function option(partial?: Partial<BetOption>): BetOption {
  return Object.assign(new BetOption("RAY", "m1", "b1", "i-ray", 100, "Home", 1.85), partial);
}

function order(partial: Partial<VenueOrder>): VenueOrder {
  return {
    provider: "RAY",
    orderId: "R1",
    createAt: Date.now(),
    odds: 1.85,
    betMoney: 100,
    reward: 0,
    money: 0,
    status: "none",
    game: "",
    match: "",
    bet: "",
    item: "",
    ...partial,
  };
}

function account(): PlatformAccount {
  return { provider: "RAY", accountId: 7 } as PlatformAccount;
}

describe("findMatchingArbVenueOrder", () => {
  it("picks newest row matching stake and odds", async () => {
    const { findMatchingArbVenueOrder } = await import("./appearArbOrderDuringRejectWait");
    const placedAt = Date.now();
    const hit = findMatchingArbVenueOrder(
      [
        order({ orderId: "old", createAt: placedAt - 60_000, betMoney: 100, odds: 1.85 }),
        order({ orderId: "new", createAt: placedAt - 200, betMoney: 100, odds: 1.85 }),
      ],
      option(),
      placedAt,
    );
    expect(hit?.orderId).toBe("new");
  });

  it("ignores a newer row with different stake", async () => {
    const { findMatchingArbVenueOrder } = await import("./appearArbOrderDuringRejectWait");
    const placedAt = Date.now();
    const hit = findMatchingArbVenueOrder(
      [
        order({ orderId: "other", createAt: placedAt, betMoney: 200, odds: 1.85 }),
        order({ orderId: "ours", createAt: placedAt - 100, betMoney: 100, odds: 1.85 }),
      ],
      option(),
      placedAt,
    );
    expect(hit?.orderId).toBe("ours");
  });
});

describe("appearArbOrderDuringRejectWait", () => {
  beforeEach(() => {
    getOrders.mockReset();
    updateVenueOrders.mockReset();
    updateVenueOrders.mockResolvedValue([]);
    refreshOrderListAfterBind.mockReset();
  });

  it("skips all venues so first getOrders is A8 updateOrders after wait", async () => {
    const { appearArbOrderDuringRejectWait, canAppearArbOrderDuringRejectWait }
      = await import("./appearArbOrderDuringRejectWait");
    expect(canAppearArbOrderDuringRejectWait("RAY")).toBe(false);
    expect(canAppearArbOrderDuringRejectWait("PB")).toBe(false);
    const ok = await appearArbOrderDuringRejectWait({
      account: account(),
      option: option(),
      linkId: 42,
      rejectWaitSec: 5,
    });
    expect(ok).toBe(false);
    expect(getOrders).not.toHaveBeenCalled();
    expect(updateVenueOrders).not.toHaveBeenCalled();
  });

  it("skips PM / PF", async () => {
    const { appearArbOrderDuringRejectWait } = await import("./appearArbOrderDuringRejectWait");
    const ok = await appearArbOrderDuringRejectWait({
      account: { provider: "Polymarket", accountId: 1 } as PlatformAccount,
      option: option(),
      linkId: 9,
      rejectWaitSec: 5,
    });
    expect(ok).toBe(false);
    expect(getOrders).not.toHaveBeenCalled();
  });
});
