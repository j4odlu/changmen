import { expect, it } from "vitest";
import { polymarketMarketAssetIds, polymarketGammaMarketAssetIds, polymarketMarketAssetFields, polymarketMarketHasAsset } from "@changmen/shared/pm_market_assets";

const positions = ["651150819117105875331414918119047680898421632356043490229292782433651916800", "651150819117105875331414918119047680898421632356043490229292782433651916801"];
const market = { version: "v2", positionIds: positions, clobTokenIds: '["101","102"]' };
it("current Gamma requires a declared protocol and the current wire field, without historical inference", () => {
  expect(polymarketGammaMarketAssetIds(market)).toEqual(positions);
  expect(polymarketGammaMarketAssetIds({ version: "v1", clobTokenIds: '["101","102"]' })).toEqual(["101", "102"]);
  for (const invalid of [
    { clobTokenIds: '["101","102"]' }, { version: "v1", clob_token_ids: '["101","102"]' },
    { version: "v1", clobTokenIds: ["101", "102"] }, { version: "v2", position_ids: positions },
    { version: "v3", positionIds: positions }, { version: "v2", positionIds: positions.map(Number) },
  ]) expect(polymarketGammaMarketAssetIds(invalid)).toEqual([]);
});
it("settlement membership never unions V2 positions with stale CTF tokens", () => {
  const mixed = { ...market, tokens: [{ token_id: "101" }] };
  expect(polymarketMarketHasAsset(mixed, "101")).toBe(false);
  expect(polymarketMarketHasAsset(mixed, positions[0])).toBe(true);
  expect(polymarketMarketHasAsset({ ...mixed, positionIds: [] }, "101")).toBe(false);
  expect(polymarketMarketHasAsset({ tokens: [{ token_id: "legacy" }] }, "legacy")).toBe(true);
  expect(polymarketMarketHasAsset({ version: "v2", tokens: [{ token_id: "101" }] }, "101")).toBe(false);
  expect(polymarketMarketHasAsset({ clobTokenIds: [], tokens: [{ token_id: "101" }] }, "101")).toBe(false);
});
it("selects IDs by protocol with both fields present and preserves full decimal precision", () => {
  expect(polymarketMarketAssetIds(market)).toEqual(positions);
  expect(polymarketMarketAssetIds({ ...market, version: "v1" })).toEqual(["101", "102"]);
});
it("accepts V2-only and snake-case fields without JSON encoding the position IDs", () => {
  expect(polymarketMarketAssetIds({ version: "v2", position_ids: positions })).toEqual(positions);
  expect(polymarketMarketAssetFields(market, [...positions].reverse())).toEqual({ positionIds: [...positions].reverse(), position_ids: [...positions].reverse() });
});
it.each([undefined, null, [], '["201","202"]', [201, 202], ["201", "201"], ["2e2", "202"], ["NaN", "202"]])("never falls back to CTF for malformed V2 IDs %j", positionIds => {
  expect(polymarketMarketAssetIds({ ...market, positionIds })).toEqual([]);
});
it.each(["v3", "", 2, undefined, null])("rejects ambiguous V2 metadata with version %j", version => {
  expect(polymarketMarketAssetIds({ ...market, version })).toEqual([]);
});
it("keeps legacy CTF-only snapshots compatible while leaving modern versions explicit", () => {
  expect(polymarketMarketAssetIds({ clob_token_ids: '["legacy-a","legacy-b"]' })).toEqual(["legacy-a", "legacy-b"]);
  expect(polymarketMarketAssetFields({ version: "v1" }, ["101", "102"])).toMatchObject({ clobTokenIds: '["101","102"]' });
});
