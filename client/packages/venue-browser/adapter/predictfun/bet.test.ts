import { describe, expect, it, vi } from "vitest";
import {
  detectionMaxPriceFromOdds,
  isValidPredictClobPrice,
  resolvePredictFunDetectionMaxPrice,
} from "./pfDetection";
import { parsePredictFunTokenConfig, resolvePredictFunPrivateKey } from "./credentials";
import { isPredictFunOrderAccepted } from "./bet";

const checkPredictFunUserBuy = vi.hoisted(() => vi.fn());
const signPredictFunUserMarketBuy = vi.hoisted(() => vi.fn());
const pfSubmitSignedOrder = vi.hoisted(() => vi.fn());

vi.mock("./userBuy", () => ({
  checkPredictFunUserBuy,
  signPredictFunUserMarketBuy,
}));

vi.mock("./pfClientApi", () => ({
  pfSubmitSignedOrder,
  pfGetOrders: vi.fn(async () => []),
}));

describe("predictfun bet helpers", () => {
  it("parses EOA private key from token json", () => {
    const cfg = parsePredictFunTokenConfig(JSON.stringify({ privateKey: "abc123" }));
    expect(resolvePredictFunPrivateKey(cfg)).toBe("0xabc123");
  });

  it("validates clob price range", () => {
    expect(isValidPredictClobPrice(0.62)).toBe(true);
    expect(isValidPredictClobPrice(0)).toBe(false);
    expect(isValidPredictClobPrice(1)).toBe(false);
  });

  it("derives detection cap from odds", () => {
    expect(detectionMaxPriceFromOdds(2)).toBe(0.5);
  });

  it("accepts create-order response with orderId", () => {
    expect(isPredictFunOrderAccepted({ orderId: "123" })).toBe(true);
    expect(isPredictFunOrderAccepted({ })).toBe(false);
  });

  it("locks detection max price from option.data when clob matches odds", () => {
    const option = {
      odds: 1.818,
      data: { detectionClobPrice: 0.55 },
    } as never;
    expect(resolvePredictFunDetectionMaxPrice(option, 1.818)).toBe(0.55);
  });

  it("ignores stale fo clob when display odds disagree", () => {
    const option = {
      odds: 1.587,
      data: { detectionClobPrice: 0.6203 },
    } as never;
    expect(resolvePredictFunDetectionMaxPrice(option, 1.587)).toBe(
      detectionMaxPriceFromOdds(1.587),
    );
  });

  it("does not treat detectionMaxPrice as raw clob", () => {
    const option = {
      odds: 1.818,
      data: {
        detectionMaxPrice: 0.5517,
        detectionClobPrice: 0.55,
      },
    } as never;
    expect(resolvePredictFunDetectionMaxPrice(option, 1.818)).toBe(0.55);
  });
});

describe("predictfun provider user path", () => {
  it("checkBet uses browser checkPredictFunUserBuy", async () => {
    checkPredictFunUserBuy.mockReset();
    checkPredictFunUserBuy.mockResolvedValueOnce({
      tokenId: "tok",
      marketId: "830202",
      apiBetMoney: 10,
      detectionOdds: 2,
      detectionMaxPrice: 0.5,
      bookPrice: 0.4,
      bookOdds: 2.5,
      bookFetchedAt: Date.now(),
      feeRateBps: 200,
      isNegRisk: false,
      isYieldBearing: false,
      side: "BUY",
      playerId: 42,
    });

    vi.resetModules();
    const { predictFunProvider } = await import("./bet");
    const account = {
      accountId: 42,
      provider: "PredictFun",
      token: JSON.stringify({
        predictAccount: `0x${"aa".repeat(20)}`,
        privyPrivateKey: `0x${"bb".repeat(32)}`,
      }),
    } as never;
    const option = {
      itemId: "tok",
      betMoney: 10,
      odds: 2,
      type: "PredictFun",
      data: { marketId: "830202", detectionOdds: 2, detectionMaxPrice: 0.5 },
    } as never;

    const out = await predictFunProvider.checkBet(account, option);
    expect(checkPredictFunUserBuy).toHaveBeenCalledOnce();
    expect(out.checkError).toBeFalsy();
    expect(out.odds).toBe(2.5);
    expect(out.data?.bookPrice).toBe(0.4);
  });
});
