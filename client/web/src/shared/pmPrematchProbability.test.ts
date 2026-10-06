import type { PmPrematchTokenSnapshot } from "@changmen/api-contract";
import { expect, it } from "vitest";
import { readPrematchProbability } from "./pmPrematchProbability";

const point = (tokenId: string, price: number): PmPrematchTokenSnapshot => ({
  tokenId, price, marketId: "map-2", status: "ready", registeredStart: 101_000,
  cutoff: 100, observationTime: 99_000, resolution: 0, checkedAt: 105_000, nextCheckAt: 705_000,
});

it("aligns persisted token prices with displayed team order", () => {
  const snapshots = { a: point("a", .435), b: point("b", .565) };
  const result = readPrematchProbability("b", "a", snapshots);
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.value.home).toBeCloseTo(56.5);
    expect(result.value.away).toBeCloseTo(43.5);
    expect(result.value.cutoff).toBe(100_000);
  }
});

it("never combines values from different registered starts or markets", () => {
  expect(readPrematchProbability("a", "b", { a: point("a", .4), b: { ...point("b", .6), cutoff: 200 } }).status).toBe("waiting");
  expect(readPrematchProbability("a", "b", { a: point("a", .4), b: { ...point("b", .6), marketId: "map-3" } }).status).toBe("waiting");
  expect(readPrematchProbability("a", "b", undefined).status).toBe("waiting");
});

it("preserves real zero and rejects invalid or post-cutoff observations", () => {
  expect(readPrematchProbability("a", "b", { a: point("a", 0), b: point("b", 1) }).status).toBe("ready");
  expect(readPrematchProbability("a", "b", { a: point("a", 1.1), b: point("b", 0) }).status).toBe("missing");
  expect(readPrematchProbability("a", "b", { a: { ...point("a", .4), observationTime: 101_000 }, b: point("b", .6) }).status).toBe("missing");
});

it("shows pending and errors instead of using an old cached price", () => {
  expect(readPrematchProbability("a", "b", { a: { ...point("a", .4), status: "pending" }, b: point("b", .6) }).status).toBe("pending");
  expect(readPrematchProbability("a", "b", { a: { ...point("a", .4), status: "error" }, b: point("b", .6) }).status).toBe("error");
});
