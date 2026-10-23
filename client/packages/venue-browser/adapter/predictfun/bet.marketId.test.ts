import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictFunMarketIndex } from "@changmen/api-contract";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { predictFunProvider } from "./bet";
import {
  __resetPredictFunTokenMarketIdsForTests,
  rememberPredictFunTokenMarketIds,
} from "./marketIndex";

const mocks = vi.hoisted(() => ({
  getEntry: vi.fn(),
  getCollectPlatform: vi.fn(),
  checkBuy: vi.fn(),
}));

vi.mock("@changmen/client-core/bridge/oddsAccess", async (importOriginal) => ({
  ...await importOriginal<typeof import("@changmen/client-core/bridge/oddsAccess")>(),
  getVenueOddsEntry: mocks.getEntry,
}));
vi.mock("@changmen/client-core/bridge/clientApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@changmen/client-core/bridge/clientApi")>(),
  getCollectPlatform: mocks.getCollectPlatform,
}));
vi.mock("./userBuy", () => ({
  checkPredictFunUserBuy: mocks.checkBuy,
  signPredictFunUserMarketBuy: vi.fn(),
}));

const account = { accountId: 42, provider: "PredictFun" } as PlatformAccount;
const index: PredictFunMarketIndex = {
  updatedAt: 1,
  marketIds: ["844582"],
  entries: [{
    sourceMatchId: "match",
    categoryId: "category",
    sourceBetId: "bet",
    homeMarketId: "844582",
    awayMarketId: "844582",
    homeTokenId: "tok-home",
    awayTokenId: "tok-away",
    homeName: "Home",
    awayName: "Away",
    homeOdds: 2,
    awayOdds: 2,
    status: "Normal",
  }],
};

describe("PredictFun marketId fallback during precheck", () => {
  beforeEach(() => {
    __resetPredictFunTokenMarketIdsForTests();
    mocks.getEntry.mockReset();
    mocks.getCollectPlatform.mockReset().mockResolvedValue(null);
    mocks.checkBuy.mockReset().mockImplementation(async params => ({
      ...params,
      bookPrice: 0.4,
      bookOdds: 2.5,
      bookFetchedAt: Date.now(),
      feeRateBps: 200,
      isNegRisk: false,
      isYieldBearing: false,
      playerId: 42,
    }));
  });

  afterEach(() => {
    __resetPredictFunTokenMarketIdsForTests();
  });

  it.each([
    { name: "explicit marketId keeps priority", data: " 100 ", home: "200", away: "201", cached: "300", target: "Home", expected: "100" },
    { name: "blank data falls back to home subscription", data: " ", home: "200", away: "201", cached: "300", target: "Home", expected: "200" },
    { name: "away subscription is selected for away token", data: "", home: "200", away: "201", cached: "300", target: "Away", expected: "201" },
    { name: "blank subscription falls back to odds cache", data: "", home: " ", away: "", cached: "300", target: "Home", expected: "300" },
    { name: "absent item falls back to odds cache", data: undefined, home: undefined, away: undefined, cached: "300", target: "Home", expected: "300" },
    { name: "absent odds entry falls back to token index", data: undefined, home: undefined, away: undefined, cached: undefined, target: "Home", expected: "844582" },
    { name: "blank odds marketId falls back to away token index", data: " ", home: "", away: " ", cached: " ", target: "Away", expected: "844582" },
  ] as const)("$name", async ({ data, home, away, cached, target, expected }) => {
    rememberPredictFunTokenMarketIds(index);
    if (cached !== undefined)
      mocks.getEntry.mockReturnValue({ marketId: cached });
    const tokenId = target === "Home" ? "tok-home" : "tok-away";
    const option = new BetOption("PredictFun", "match", "bet", tokenId, 10, target, 2);
    if (data !== undefined)
      option.data = { marketId: data };
    if (home !== undefined || away !== undefined)
      option.item = { homeSubscribeId: home, awaySubscribeId: away } as BetOption["item"];

    const result = await predictFunProvider.checkBet(account, option);

    expect(result.checkError).toBeFalsy();
    expect(mocks.checkBuy).toHaveBeenCalledExactlyOnceWith({
      account, marketId: expected, tokenId, apiBetMoney: 10,
      detectionMaxPrice: 0.5, detectionOdds: 2,
    });
    expect(result.data?.marketId).toBe(expected);
    expect(mocks.getCollectPlatform).not.toHaveBeenCalled();
  });

  it("refreshes MarketIndex and retries when local sources are missing", async () => {
    mocks.getCollectPlatform.mockResolvedValue({ MarketIndex: index });
    const option = new BetOption("PredictFun", "match", "bet", "tok-away", 10, "Away", 2);

    const result = await predictFunProvider.checkBet(account, option);

    expect(result.checkError).toBeFalsy();
    expect(result.data?.marketId).toBe("844582");
    expect(mocks.getCollectPlatform).toHaveBeenCalledExactlyOnceWith("PredictFun");
    expect(mocks.checkBuy).toHaveBeenCalledOnce();
  });

  it("still rejects an unknown token without requesting an orderbook", async () => {
    const option = new BetOption("PredictFun", "match", "bet", "unknown", 10, "Home", 2);

    const result = await predictFunProvider.checkBet(account, option);

    expect(result.checkError).toContain("缺少 Predict.fun marketId");
    expect(result.data).toBeNull();
    expect(mocks.checkBuy).not.toHaveBeenCalled();
  });
});
