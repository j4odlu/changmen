import { expect, test } from "vitest";
import { mergePolymarketClobMarket, polymarketClobMarketAssetIds, polymarketMarketAssetIds } from "@changmen/shared/pm_market_assets";
import { getPolymarketMarketBlockReason } from "@changmen/venue-browser/polymarket/markets/pmMarketGuard";
import { resolvePolymarketSettlement } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { lookupGammaMarketAsset } from "../../../../polymarket/markets/gammaAssetLookup";

const cases = ["v1", "v2"] as const;
function base(version: typeof cases[number]) {
  return { version, conditionId: "0xabc", outcomes: '["Home","Away"]', outcomePrices: '["0.5","0.5"]',
    ...(version === "v2" ? { positionIds: ["101", "102"], clobTokenIds: '["901","902"]' } : { clobTokenIds: '["101","102"]' }) };
}
const tokens = [{ token_id: "102", outcome: "Away", winner: true }, { token_id: "101", outcome: "Home", winner: false }];

test.each(cases)("%s overlay preserves original IDs, outcome labels and price ordering", version => {
  const original = base(version);
  const merged = mergePolymarketClobMarket({ version, condition_id: "0xABC", tokens }, original);
  expect(original.outcomePrices).toBe('["0.5","0.5"]');
  expect(polymarketMarketAssetIds(merged)).toEqual(["101", "102"]);
  expect(merged).toMatchObject({ outcomes: '["Home","Away"]', outcomePrices: '["0","1"]' });
  expect(resolvePolymarketSettlement(merged!)).toEqual({ winningAssetId: "102", kind: "official" });
});

test.each(cases)("%s identity conflicts cannot be repaired by merging", version => {
  const original = base(version);
  for (const conflict of [
    { version, tokens: [{ token_id: "101", winner: false }, { token_id: "999", winner: true }] },
    { version, condition_id: "wrong-condition", tokens },
    { version: version === "v1" ? "v2" : "v1", tokens },
    { version: "future", tokens },
    { version, tokens: [tokens[0]] },
    { version, tokens: [tokens[0], tokens[0]] },
    { version, tokens: [{ token_id: 101 }, { token_id: 102 }] },
  ]) {
    expect(mergePolymarketClobMarket(conflict as never, original)).toBe(original);
  }
});

test.each(cases)("%s explicit fields and CLOB token rows must agree before preflight", version => {
  const market = { ...base(version), active: true, accepting_orders: true,
    tokens: [{ token_id: "201", winner: false }, { token_id: "202", winner: false }] };
  expect(polymarketClobMarketAssetIds(market)).toEqual([]);
  expect(getPolymarketMarketBlockReason(market, "101", "clob")).toContain("不一致");
  expect(getPolymarketMarketBlockReason({ ...market, tokens }, "101", "clob", "wrong-condition")).toContain("不一致");
});

test.each(cases)("%s multiple official winners cannot fall back to either price or array order", version => {
  const market = { ...base(version), outcomePrices: '["0.999","0.001"]', tokens: tokens.map(token => ({ ...token, winner: true })) };
  expect(resolvePolymarketSettlement(market)).toBeNull();
  expect(getPolymarketMarketBlockReason(market, "101", "clob")).toContain("赛果不明确");
});

test("conflicting field aliases are rejected rather than selecting the first one", () => {
  expect(polymarketMarketAssetIds({ version: "v2", positionIds: ["101", "102"], position_ids: ["102", "101"] })).toEqual([]);
  expect(polymarketMarketAssetIds({ version: "v1", clobTokenIds: '["101","102"]', clob_token_ids: '["101","999"]' })).toEqual([]);
});

test("CLOB-only V2 results can establish identity without borrowing unmapped Gamma prices", () => {
  const clob = { version: "v2", condition_id: "0xabc", tokens: [{ token_id: "201", price: 0.5 }, { token_id: "202", price: 0.5 }] };
  const merged = mergePolymarketClobMarket(clob);
  expect(polymarketMarketAssetIds(merged)).toEqual(["201", "202"]);
  const unmapped = { outcomePrices: '["1","0"]', outcomes: '["unmapped","labels"]' };
  expect(mergePolymarketClobMarket(clob, unmapped)).toBe(unmapped);
});

test.each([{ clobTokenIds: '["101","102"]' }, { clobTokenIds: [] },
  { clobTokenIds: '["101","102"]', clob_token_ids: '["101","999"]' }])("legacy Gamma identity is still checked when version is absent: %j", market => {
  expect(getPolymarketMarketBlockReason(market, "999")).toContain("不一致");
});

test("legacy asset lookup cannot treat an explicit mismatch as a successful match", async () => {
  await expect(lookupGammaMarketAsset("999", async () => [{ clobTokenIds: '["101","102"]' }])).rejects.toThrow("不一致");
});
test("live Gamma lookup rejects unversioned assets even when the requested ID is present", async () => {
  await expect(lookupGammaMarketAsset("101", async () => [{ clobTokenIds: '["101","102"]' }])).rejects.toThrow("不一致");
  expect(getPolymarketMarketBlockReason({ clobTokenIds: '["101","102"]' }, "101")).toContain("不一致");
});
