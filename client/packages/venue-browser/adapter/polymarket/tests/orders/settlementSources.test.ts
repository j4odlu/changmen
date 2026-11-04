import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fetchPolymarketVenueOrdersBundle } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { pmGetTrades } from "@changmen/venue-browser/polymarket/orders/pmClientApi";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: vi.fn(), pmGetOrder: vi.fn() }));

const gammaStates = ["valid", "missing", "invalid", "error"] as const;
const clobStates = ["aligned", "reversed", "missing", "error", "wrongCondition", "differentSet", "unsupported", "ambiguous"] as const;
const rows = (["v1", "v2"] as const).flatMap(version => gammaStates.flatMap(gammaState => clobStates.flatMap(clobState =>
  [false, true].flatMap(earlyPrice => ["101", "102", "777"].map(held => ({ version, gammaState, clobState, earlyPrice, held }))))));
let warnings: ReturnType<typeof vi.spyOn>;
beforeAll(() => { warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterAll(() => { warnings.mockRestore(); });

test.each(rows)("$version Gamma=$gammaState CLOB=$clobState earlyPrice=$earlyPrice held=$held preserves settlement and money", async ({ version, gammaState, clobState, earlyPrice, held }) => {
  const gamma = { version, conditionId: "source-condition", outcomes: '["Home","Away"]',
    outcomePrices: earlyPrice ? '["0.999","0.001"]' : '["0.5","0.5"]',
    ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }) };
  const tokens = [{ token_id: "101", outcome: "Home", winner: clobState === "ambiguous" },
    { token_id: clobState === "differentSet" ? "999" : "102", outcome: "Away", winner: true }];
  const clob = { ...(version === "v2" ? { version } : {}),
    ...(clobState === "unsupported" ? { version: "future" } : {}),
    condition_id: clobState === "wrongCondition" ? "other-condition" : "source-condition",
    tokens: clobState === "missing" ? [] : clobState === "reversed" ? [...tokens].reverse() : tokens };
  vi.mocked(pmGetTrades).mockResolvedValue([{ market: "source-condition", asset_id: held, size: "10", price: "0.4",
    side: "BUY", taker_order_id: "source-order", status: "CONFIRMED", match_time: String(Math.floor(Date.now() / 1000)) }]);
  vi.mocked(polymarketPluginGet).mockImplementation(async raw => {
    if (String(raw).includes("clob.polymarket.com")) {
      if (clobState === "error") throw new Error("CLOB unavailable");
      return clob;
    }
    if (gammaState === "error") throw new Error("Gamma unavailable");
    return gammaState === "missing" ? [] : [{ ...gamma, ...(gammaState === "invalid" ? { version: undefined } : {}) }];
  });
  const { orders } = await fetchPolymarketVenueOrdersBundle({ provider: "Polymarket", token: "{}", accountId: 1 } as never);
  expect(orders).toHaveLength(1);
  const order = orders[0]!;
  expect(order).toMatchObject({ orderId: "source-order", pmTokenId: held, pmConditionId: "source-condition", pmShares: 10, betMoney: 4 });

  // Independent policy table: valid Gamma can retain its early-price result;
  // accepted CLOB official results take priority, and multiple winners block settlement.
  const validGamma = gammaState === "valid";
  const official = clobState === "aligned" || clobState === "reversed" || clobState === "differentSet" && !validGamma;
  const members = clobState === "differentSet" && !validGamma ? ["101", "999"] : ["101", "102"];
  const winner = clobState === "ambiguous" ? undefined : official ? members[1] : validGamma && earlyPrice ? "101" : undefined;
  const settled = winner !== undefined && members.includes(held);
  expect(order.status).toBe(settled ? held === winner ? "win" : "lose" : "none");
  expect(order.money).toBe(settled ? held === winner ? 6 : -4 : 0);
  expect(order.pmSellState).toBe(settled && official ? "settled" : "open");
  if (settled) {
    expect(order.pmMatchResult).toBe(held === winner ? "win" : "lose");
    expect(order.reward).toBe(held === winner ? 10 : 0);
  } else expect(order.pmMatchResult).toBeUndefined();
});
