import { describe, expect, it, vi } from "vitest";
import {
  computePolymarketSettlement,
  computePolymarketSettlementFromOrderRaw,
  isPolymarketMarketResolved,
  clobMarketToGammaShape,
  resolvePolymarketSettlement,
  fetchGammaMarketsByConditionIds,
  enrichMarketsFromClob,
  lookupGammaMarket,
  polymarketShareCount,
  polymarketBuyStakeUsdc,
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
  it.each([undefined, "v2"])("indexes validated CLOB settlement without a Gamma response (version=%s)", async version => {
    const clob = { ...(version ? { version } : {}), condition_id: "condition",
      tokens: [{ token_id: "101", outcome: "Home", winner: true }, { token_id: "102", outcome: "Away", winner: false }] };
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => clob });
    try {
      const markets = await enrichMarketsFromClob(new Map(), ["condition"]);
      expect(computePolymarketSettlement({ market: "condition", asset_id: "101", size: "10" }, lookupGammaMarket(markets, { market: "condition" }), 4))
        .toEqual({ status: "win", reward: 10, money: 6, kind: "official" });
      expect(lookupGammaMarket(markets, { asset_id: "101" })).toBe(markets.get("condition"));
    } finally { request.mockRestore(); }
  });
  it("rejects a CLOB response for a different condition even without Gamma", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ version: "v2", condition_id: "other",
      tokens: [{ token_id: "101", winner: true }, { token_id: "102", winner: false }] }) });
    try { expect((await enrichMarketsFromClob(new Map(), ["condition"])).size).toBe(0); }
    finally { request.mockRestore(); }
  });
  it.each(["v1", "v2"])("%s missing trade assets require an unambiguous, complete outcome mapping", version => {
    for (const outcomes of ['["Same","Same"]', '["Same"]', '["","Same"]']) {
      const market = { version, ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }),
        outcomes, outcomePrices: '["1","0"]' };
      expect(computePolymarketSettlement({ outcome: "Same", size: "10" }, market, 4)).toBeNull();
    }
    const identity = { version, ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }) };
    expect(computePolymarketSettlement({ outcome: " Away ", size: "10" },
      { ...identity, outcomes: '["Home","Away"]', outcomePrices: '["0","1"]' }, 4)).toMatchObject({ status: "win", money: 6 });
    expect(computePolymarketSettlement({ asset_id: "102", outcome: "Same", size: "10" },
      { ...identity, outcomes: '["Same","Same"]', outcomePrices: '["0","1"]' }, 4)).toMatchObject({ status: "win", money: 6 });
  });
  it("refuses a trade or stored-order condition mismatch before financial calculations", () => {
    const market = { version: "v2", conditionId: "condition", positionIds: ["101", "102"], tokens: [{ token_id: "101", winner: true }] };
    expect(computePolymarketSettlement({ asset_id: "102", market: "other", size: "10" }, market, 4)).toBeNull();
    expect(computePolymarketSettlementFromOrderRaw({ pmTokenId: "102", pmConditionId: "other", pmShares: 10 }, market, 4)).toBeNull();
  });
  it.each(["v1", "v2"])("does not lose a position after a conflicting %s CLOB overlay", version => {
    const gamma = { version, conditionId: "condition", outcomePrices: '["0.5","0.5"]',
      ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }) };
    const mixed = clobMarketToGammaShape({ version, condition_id: "condition", tokens: [{ token_id: "101", winner: false }, { token_id: "999", winner: true }] }, gamma);
    expect(mixed).toBe(gamma);
    expect(computePolymarketSettlement({ asset_id: "101", size: "10" }, mixed, 4)?.status).toBe("none");
  });
  it.each(["v1", "v2"])("does not use the first of multiple %s winners", version => {
    const market = { version, ...(version === "v2" ? { positionIds: ["101", "102"] } : { clobTokenIds: '["101","102"]' }),
      outcomePrices: '["1","0"]', tokens: [{ token_id: "101", winner: true }, { token_id: "102", winner: true }] };
    expect(resolvePolymarketSettlement(market)).toBeNull();
    expect(computePolymarketSettlementFromOrderRaw({ pmTokenId: "102", pmShares: 10 }, market, 4)?.status).toBe("none");
  });
  it.each([true, false])("does not record an unknown CTF asset as a V2 loser (official=%s)", official => {
    const market = { version: "v2", positionIds: ["201", "202"], clobTokenIds: '["101","102"]', outcomePrices: '["1","0"]',
      tokens: [{ token_id: "201", winner: official }, { token_id: "101", winner: false }] };
    expect(computePolymarketSettlement({ asset_id: "101", size: "10" }, market, 4)).toBeNull();
    expect(computePolymarketSettlementFromOrderRaw({ pmTokenId: "101", pmShares: 10 }, market, 4)).toBeNull();
    expect(computePolymarketSettlement({ asset_id: "202", size: "10" }, market, 4)).toMatchObject({ status: "lose", money: -4 });
  });
  it.each([9999, 10000, 10001, 2000000])("keeps normalized CLOB shares in server settlement: %s", shares => {
    expect(polymarketShareCount(String(shares))).toBe(shares);
    expect(polymarketBuyStakeUsdc(String(shares), 0.5)).toBe(shares / 2);
    const market = { tokens: [{ token_id: ilbirsTokenWin, winner: true }] };
    expect(computePolymarketSettlement({ ...ilbirsTrade, size: String(shares) }, market, shares / 2))
      .toEqual({ status: "win", reward: shares, money: shares / 2, kind: "official" });
  });
  it("looks up V2 positions when the old Gamma token filter misses, including closed markets", async () => {
    const urls = [];
    const market = { version: "v2", conditionId: "cond-v2", positionIds: ["201", "202"], clobTokenIds: '["101","102"]', closed: true };
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async raw => {
      const url = new URL(String(raw));
      urls.push(url);
      return { ok: true, json: async () => url.searchParams.has("position_ids") ? [market] : [] };
    });
    try {
      const markets = await fetchGammaMarketsByConditionIds([], ["201"]);
      expect(lookupGammaMarket(markets, { asset_id: "201" })).toEqual(market);
      expect(lookupGammaMarket(markets, { asset_id: "101" })).toBeUndefined();
      expect(urls).toHaveLength(2);
      expect(urls[1].searchParams.get("position_ids")).toBe("201");
      expect(urls.every(url => url.searchParams.get("closed") === "any")).toBe(true);
    }
    finally { request.mockRestore(); }
  });

  it("keeps V2 price ordering and CLOB overlay on the selected position IDs", () => {
    const base = { version: "v2", positionIds: ["201", "202"], clobTokenIds: '["101","102"]', outcomePrices: '["0.99","0.01"]' };
    expect(resolvePolymarketSettlement(base)).toEqual({ winningAssetId: "201", kind: "price" });
    const reversed = clobMarketToGammaShape({ tokens: [{ token_id: "202", winner: true }, { token_id: "201", winner: false }] }, base);
    expect(reversed.positionIds).toEqual(["201", "202"]);
    expect(resolvePolymarketSettlement(reversed)).toEqual({ winningAssetId: "202", kind: "official" });
    expect(resolvePolymarketSettlement(clobMarketToGammaShape({ tokens: [{ token_id: "101", winner: true }] }, base)))
      .toEqual({ winningAssetId: "201", kind: "price" });
    expect(resolvePolymarketSettlement({ ...base, positionIds: undefined })).toBeNull();
  });
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
