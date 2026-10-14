import { describe, expect, it } from "vitest";
import {
  computePolymarketSettlement,
  computePolymarketSettlementFromOrderRaw,
  isPolymarketMarketResolved,
  clobMarketToGammaShape,
  resolvePolymarketSettlement,
} from "./settlement.js";

const ilbirsTokenWin = "12876938733604859423663202044051912631612545733461708116502231340403727260024";
const ilbirsTokenLose = "64898223322413645971505217367611485629461864230905813190263318936513341854768";

const ilbirsMarket = {
  condition_id: "0xfaf8d69ad2f0677b6f987e7da1c94022f73073120e9ed28969fcf5153475116f",
  closed: false,
  outcomes: "[\"Ilbirs eSports\", \"BALU\"]",
  outcomePrices: "[\"0.9995\", \"0.0005\"]",
  clobTokenIds: `["${ilbirsTokenWin}", "${ilbirsTokenLose}"]`,
};

const ilbirsTrade = {
  asset_id: ilbirsTokenWin,
  side: "BUY",
  size: "6.756753",
  price: "0.74",
  outcome: "Ilbirs eSports",
};

describe("polymarket settlement (server)", () => {
  it.each([["0.99", "0.01"], ["0.9995", "0.0005"], ["1", "0"]])("uses endpoint prices before an official winner: %j", (home, away) => {
    const market = { ...ilbirsMarket, closed: true, umaResolutionStatus: "proposed",
      outcomePrices: JSON.stringify([home, away]),
      tokens: [{ token_id: ilbirsTokenWin, winner: false }, { token_id: ilbirsTokenLose, winner: false }] };
    expect(isPolymarketMarketResolved(market)).toBe(true);
    for (const asset_id of [ilbirsTokenWin, ilbirsTokenLose]) {
      const expected = asset_id === ilbirsTokenWin
        ? { status: "win", money: 1.7568, reward: 6.7568, kind: "price" }
        : { status: "lose", money: -5, reward: 0, kind: "price" };
      expect(computePolymarketSettlement({ ...ilbirsTrade, asset_id }, market, 5))
        .toEqual(expected);
      expect(computePolymarketSettlementFromOrderRaw({ pmTokenId: asset_id, pmShares: 6.756753 }, market, 5))
        .toEqual(expected);
    }
  });

  it("prefers the official winner when prices favor the opponent", () => {
    const market = { ...ilbirsMarket, tokens: [{ token_id: ilbirsTokenLose, winner: true }] };
    expect(computePolymarketSettlement(ilbirsTrade, market, 5))
      .toEqual({ status: "lose", money: -5, reward: 0, kind: "official" });
  });

  it("keeps Gamma prices bound to their token IDs when CLOB reverses the token order", () => {
    const tokens = [{ token_id: ilbirsTokenLose, price: 0.0005 }, { token_id: ilbirsTokenWin, price: 0.9995 }];
    const market = clobMarketToGammaShape({ tokens }, ilbirsMarket);
    expect(resolvePolymarketSettlement(market)).toEqual({ winningAssetId: ilbirsTokenWin, kind: "price" });
    expect(computePolymarketSettlement({ ...ilbirsTrade, asset_id: undefined }, market, 5))
      .toMatchObject({ status: "win", kind: "price" });
    expect(resolvePolymarketSettlement(clobMarketToGammaShape({ tokens }, { outcomePrices: '["1", "0"]' }))).toBeNull();
  });

  it.each([
    { outcomePrices: '["0.9899", "0.0101"]' },
    { outcomePrices: '["0.99", "0.99"]' },
    { outcomePrices: '["1.01", "0"]' },
    { outcomePrices: '["0.99", "NaN"]' },
    { outcomePrices: '["0.99"]' },
    { clobTokenIds: '["same", "same"]' },
    { clobTokenIds: '[]' },
  ])("does not infer a result from invalid or subthreshold data: %j", (patch) => {
    expect(resolvePolymarketSettlement({ ...ilbirsMarket, ...patch })).toBeNull();
  });

  it("resolves via official tokens[].winner (kind=official)", () => {
    const official = {
      ...ilbirsMarket,
      outcomePrices: "[\"0.55\", \"0.45\"]",
      tokens: [
        { token_id: ilbirsTokenWin, outcome: "Ilbirs eSports", price: 0.55, winner: true },
        { token_id: ilbirsTokenLose, outcome: "BALU", price: 0.45, winner: false },
      ],
    };
    const out = computePolymarketSettlement(ilbirsTrade, official, 5);
    expect(out).toMatchObject({ status: "win", kind: "official" });
  });

  it("keeps none for open market prices", () => {
    const open = { ...ilbirsMarket, outcomePrices: "[\"0.74\", \"0.26\"]" };
    expect(isPolymarketMarketResolved(open)).toBe(false);
    expect(computePolymarketSettlement(ilbirsTrade, open, 5).status).toBe("none");
  });

  it("settles from CLOB market tokens[].winner", () => {
    const shaped = clobMarketToGammaShape({
      closed: true,
      condition_id: "0xabc",
      tokens: [
        { token_id: ilbirsTokenWin, outcome: "Ilbirs eSports", price: 0.55, winner: true },
        { token_id: ilbirsTokenLose, outcome: "BALU", price: 0.45, winner: false },
      ],
    });
    const out = computePolymarketSettlement(ilbirsTrade, shaped, 5);
    expect(out).toMatchObject({ status: "win", kind: "official" });
  });

  it("settles from RDS raw when trade row missing", () => {
    const raw = {
      pmTokenId: ilbirsTrade.asset_id,
      pmShares: 6.756753,
      pmStakeUsdc: 5,
    };
    const official = { ...ilbirsMarket, tokens: [{ token_id: ilbirsTokenWin, winner: true }] };
    const out = computePolymarketSettlementFromOrderRaw(raw, official, 5);
    expect(out).toMatchObject({ status: "win", money: 1.7568, kind: "official" });
  });
});
