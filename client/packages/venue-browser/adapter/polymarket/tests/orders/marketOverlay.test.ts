import { expect, test, vi } from "vitest";
import { fetchPolymarketVenueOrdersBundle } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { pmGetTrades } from "@changmen/venue-browser/polymarket/orders/pmClientApi";
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: vi.fn(), pmGetOrder: vi.fn() }));

test.each([
  ["CTF", undefined, []], ["V2", "v2", []],
  ["CTF", undefined, [{ conditionId: "condition", clobTokenIds: '["101","102"]' }]],
  ["V2", "v2", [{ conditionId: "condition", positionIds: ["101", "102"] }]],
])("%s official CLOB settlement works independently of missing or invalid Gamma (%j)", async (_protocol, version, gamma) => {
  const clob = { ...(version ? { version } : {}), condition_id: "condition",
    tokens: [{ token_id: "101", outcome: "Home", winner: true }, { token_id: "102", outcome: "Away", winner: false }] };
  vi.mocked(pmGetTrades).mockResolvedValue([{ market: "condition", asset_id: "101", size: "10", price: "0.4", side: "BUY", taker_order_id: "held-order", status: "CONFIRMED", match_time: String(Math.floor(Date.now() / 1000)) }]);
  vi.mocked(polymarketPluginGet).mockImplementation(async raw => String(raw).includes("/markets/condition") ? clob : gamma);
  const bundle = await fetchPolymarketVenueOrdersBundle({ provider: "Polymarket", token: "{}", accountId: 1 } as never);
  expect(bundle.orders[0]).toMatchObject({ status: "win", pmMatchResult: "win", pmSellState: "settled", pmTokenId: "101", pmShares: 10 });
});

test.each(["v1", "v2"])("complete %s order refresh keeps conflicting CLOB results away from held assets", async version => {
  const gamma = { version, conditionId: "condition", outcomePrices: '["0.5","0.5"]',
    ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }) };
  const clob = { version, condition_id: "condition", tokens: [{ token_id: "101", winner: false }, { token_id: "999", winner: true }] };
  vi.mocked(pmGetTrades).mockResolvedValue([{ market: "condition", asset_id: "101", size: "10", price: "0.4", side: "BUY", taker_order_id: "held-order", status: "CONFIRMED", match_time: String(Math.floor(Date.now() / 1000)) }]);
  vi.mocked(polymarketPluginGet).mockImplementation(async raw => String(raw).includes("/markets/condition") ? clob : [gamma]);
  const bundle = await fetchPolymarketVenueOrdersBundle({ provider: "Polymarket", token: "{}", accountId: 1 } as never);
  expect(bundle.orders[0]).toMatchObject({ status: "none", money: 0, pmSellState: "open" });
});
