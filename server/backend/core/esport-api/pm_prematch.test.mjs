import { expect, it, vi } from "vitest";
vi.mock("@changmen/db", () => ({ fetchPmPrematchPrices: vi.fn() }));
import { attachPmPrematchPrices } from "./pm_prematch.js";

it("batches saved token reads and keeps cache DTOs immutable", async () => {
  const matches = [{ Bets: [{ Sources: { Polymarket: { HomeID: "a", AwayID: "b" } } }] }, { Bets: [] }];
  const load = vi.fn().mockResolvedValue({ a: { price: .435 }, b: { price: .565 }, other: { price: .9 } });
  const result = await attachPmPrematchPrices(matches, load);
  expect(load).toHaveBeenCalledWith(["a", "b"]);
  expect(result[0].PmPrematch).toEqual({ a: { price: .435 }, b: { price: .565 } });
  expect(result[1].PmPrematch).toEqual({});
  expect(matches[0]).not.toHaveProperty("PmPrematch");
});
