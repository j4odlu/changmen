import { describe, expect, it, vi } from "vitest";
import {
  computePolymarketBuyAllInStakeUsdc,
  computePolymarketPlatformFeeUsdc,
  enrichPolymarketBuyVenueOrderWithFee,
  parsePolymarketMarketFeeDetails,
} from "@changmen/venue-browser/polymarket/orders/pmFee";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({
  polymarketPluginGet: vi.fn(async () => ({
    fd: { r: 0.05, e: 1, to: true },
  })),
}));

describe("computePolymarketPlatformFeeUsdc", () => {
  it("matches sports fee table at 100 shares @ 0.40 (rate 0.05 → 1.20)", () => {
    // docs: 100 shares @ $0.40 → Trade Value $40, Taker Fee $1.20 (sports)
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.4,
      feeRate: 0.05,
    })).toBe(1.2);
  });

  it("peaks at 0.50 for sports (100 shares → 1.25)", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.5,
      feeRate: 0.05,
    })).toBe(1.25);
  });

  it("returns 0 for maker when takerOnly", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 100,
      price: 0.4,
      feeRate: 0.05,
      takerOnly: true,
      isTaker: false,
    })).toBe(0);
  });

  it("returns 0 when feeRate is 0", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 25,
      price: 0.4,
      feeRate: 0,
    })).toBe(0);
  });

  it("example 10U @ 0.4 → 25 shares sports fee 0.3", () => {
    expect(computePolymarketPlatformFeeUsdc({
      shares: 25,
      price: 0.4,
      feeRate: 0.05,
    })).toBe(0.3);
  });
});

describe("computePolymarketBuyAllInStakeUsdc", () => {
  it("returns match fillPrice and all-in avg separately", () => {
    const r = computePolymarketBuyAllInStakeUsdc({
      grossStakeUsdc: 10,
      shares: 25,
      feeRate: 0.05,
    });
    expect(r.fillPrice).toBeCloseTo(0.4, 6);
    expect(r.feeUsdc).toBe(0.3);
    expect(r.allInStakeUsdc).toBe(10.3);
    expect(r.allInAvgPrice).toBeCloseTo(10.3 / 25, 6);
  });

  it("uses explicit feeUsdc when provided", () => {
    const r = computePolymarketBuyAllInStakeUsdc({
      grossStakeUsdc: 10,
      shares: 20,
      feeUsdc: 0.5,
    });
    expect(r.feeUsdc).toBe(0.5);
    expect(r.allInStakeUsdc).toBe(10.5);
    expect(r.fillPrice).toBe(0.5);
    expect(r.allInAvgPrice).toBeCloseTo(10.5 / 20, 6);
  });
});

describe("parsePolymarketMarketFeeDetails", () => {
  it("reads fd from clob-markets row", () => {
    expect(parsePolymarketMarketFeeDetails({
      fd: { r: 0.05, e: 1, to: true },
    })).toEqual({ feeRate: 0.05, exponent: 1, takerOnly: true });
  });

  it("defaults missing fd to zero rate", () => {
    expect(parsePolymarketMarketFeeDetails({})).toEqual({
      feeRate: 0,
      exponent: 1,
      takerOnly: true,
    });
  });
});
