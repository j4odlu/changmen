import { describe, expect, it } from "vitest";
import {
  alignPolymarketPriceToTick,
  isPolymarketPriceOnTick,
  normalizePolymarketTickSize,
} from "../../pmTickPrice";

describe("normalizePolymarketTickSize", () => {
  it("accepts official ticks including 0.0025", () => {
    expect(normalizePolymarketTickSize("0.01")).toBe("0.01");
    expect(normalizePolymarketTickSize(0.001)).toBe("0.001");
    expect(normalizePolymarketTickSize("0.0025")).toBe("0.0025");
  });

  it("rejects unknown ticks", () => {
    expect(() => normalizePolymarketTickSize("0.05")).toThrow(/tick_size/);
  });
});

describe("isPolymarketPriceOnTick / alignPolymarketPriceToTick", () => {
  it("validates 0.01 tick", () => {
    expect(isPolymarketPriceOnTick(0.99, "0.01")).toBe(true);
    expect(isPolymarketPriceOnTick(0.995, "0.01")).toBe(false);
    expect(alignPolymarketPriceToTick(0.995, "0.01", "floor")).toBe(0.99);
  });

  it("validates 0.001 tick", () => {
    expect(isPolymarketPriceOnTick(0.995, "0.001")).toBe(true);
    expect(isPolymarketPriceOnTick(0.991, "0.001")).toBe(true);
  });

  it("validates 0.0025 tick", () => {
    expect(isPolymarketPriceOnTick(0.99, "0.0025")).toBe(true);
    expect(isPolymarketPriceOnTick(0.9925, "0.0025")).toBe(true);
    expect(isPolymarketPriceOnTick(0.995, "0.0025")).toBe(true);
    expect(isPolymarketPriceOnTick(0.991, "0.0025")).toBe(false);
  });
});
