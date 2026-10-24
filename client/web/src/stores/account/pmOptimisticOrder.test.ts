import { beforeEach, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { persistPolymarketMatchedBuyOrder } from "./pmOptimisticOrder";

const io = vi.hoisted(() => ({ build: vi.fn(), save: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ buildPolymarketMatchedBuyVenueOrderFromBet: io.build }));
vi.mock("@/api/order", () => ({ saveOrders: io.save }));
const account = { provider: "Polymarket", accountId: 317 } as PlatformAccount;
const option = new BetOption("Polymarket", "match", "condition", "token", 10, "Home", 2);
option.newOdds = 2;
option.data = { limitPrice: 0.51 };
beforeEach(() => {
  vi.resetAllMocks();
  io.save.mockResolvedValue(undefined);
  io.build.mockResolvedValue({ provider: "Polymarket", orderId: "original", odds: 2,
    pmFillPrice: 0.5044, pmShares: 10, pmStakeUsdc: 5.044 } as VenueOrder);
});

function result() {
  return Object.assign(new BetResult("Polymarket", true, "matched", { order: {
    side: "BUY", makerAmount: "5100000", takerAmount: "10000000", signature: "must-not-persist",
  } }, { orderID: "original" }), { orderId: "original", beginTime: 1790000000000 });
}

it("saves the immediate fill without adding signed quantities for odds display", async () => {
  const saved = await persistPolymarketMatchedBuyOrder(account, option, result());
  expect(saved?.pmSubmission).toBeUndefined();
  expect(saved?.pmOrderPrice).toBeUndefined();
  expect(saved?.pmFillPrice).toBe(0.5044);
  expect(saved?.odds).toBe(2);
  expect(io.save).toHaveBeenCalledWith(account, [saved]);
  expect(JSON.stringify(saved)).not.toContain("must-not-persist");
});

it("keeps fills without signed evidence and never fabricates a snapshot from option prices", async () => {
  const missing = result(); missing.request = undefined;
  expect((await persistPolymarketMatchedBuyOrder(account, option, missing))?.pmSubmission).toBeUndefined();
  expect(io.save).toHaveBeenCalledTimes(1);
});

it("does not save a non-PM or unconfirmed order", async () => {
  expect(await persistPolymarketMatchedBuyOrder({ accountId: 317, provider: "RAY" } as PlatformAccount, option, result())).toBeNull();
  expect(io.build).not.toHaveBeenCalled();
  io.build.mockResolvedValue(null);
  expect(await persistPolymarketMatchedBuyOrder(account, option, result())).toBeNull();
  expect(io.save).not.toHaveBeenCalled();
});
