import { beforeEach, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { persistPolymarketMatchedBuyOrder } from "./pmOptimisticOrder";

const io = vi.hoisted(() => ({ build: vi.fn(), save: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket", () => ({ buildPolymarketMatchedBuyVenueOrderFromBet: io.build }));
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

it("keeps the submitted BUY price separately from the actual fill without adding a recovery snapshot or signature", async () => {
  const saved = await persistPolymarketMatchedBuyOrder(account, option, result());
  expect(saved?.pmSubmission).toBeUndefined();
  expect(saved?.pmOrderPrice).toBe(0.51);
  expect(saved?.pmFillPrice).toBe(0.5044);
  expect(saved?.odds).toBe(2);
  expect(io.save).toHaveBeenCalledWith(account, [saved]);
  expect(JSON.stringify(saved)).not.toContain("must-not-persist");
});

it.each(["different-order", "sell", "contradictory-response"])("does not attach inconsistent submission evidence: %s", async scenario => {
  const submitted = result();
  if (scenario === "different-order") {
    submitted.orderId = "different-order";
    submitted.response = { orderID: "different-order" };
  }
  if (scenario === "sell") (submitted.request as { order: { side: string } }).order.side = "SELL";
  if (scenario === "contradictory-response") submitted.response = { orderID: "different-order" };
  const saved = await persistPolymarketMatchedBuyOrder(account, option, submitted);
  expect(saved?.pmSubmission).toBeUndefined();
  expect(saved?.pmOrderPrice).toBeUndefined();
  expect(saved?.pmFillPrice).toBe(0.5044);
  expect(io.save).toHaveBeenCalledWith(account, [saved]);
});

it.each(["request", "takerAmount"])("keeps fills missing %s without fabricating a submitted price from option prices", async field => {
  const missing = result();
  if (field === "request") missing.request = undefined;
  else delete (missing.request as { order: { takerAmount?: string } }).order.takerAmount;
  const saved = await persistPolymarketMatchedBuyOrder(account, option, missing);
  expect(saved?.pmSubmission).toBeUndefined();
  expect(saved?.pmOrderPrice).toBeUndefined();
  expect(io.save).toHaveBeenCalledTimes(1);
});

it("does not save a non-PM or unconfirmed order", async () => {
  expect(await persistPolymarketMatchedBuyOrder({ accountId: 317, provider: "RAY" } as PlatformAccount, option, result())).toBeNull();
  expect(io.build).not.toHaveBeenCalled();
  io.build.mockResolvedValue(null);
  expect(await persistPolymarketMatchedBuyOrder(account, option, result())).toBeNull();
  expect(io.save).not.toHaveBeenCalled();
});
