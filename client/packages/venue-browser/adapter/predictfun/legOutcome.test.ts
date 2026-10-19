import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import {
  resolvePredictFunListLegOutcome,
  resolvePredictFunProviderLegOutcome,
} from "./legOutcome";

const pfGetOrder = vi.hoisted(() => vi.fn());

vi.mock("./pfClientApi", () => ({
  pfGetOrder,
  pfGetOrders: vi.fn(),
}));

describe("resolvePredictFunListLegOutcome", () => {
  it("treats reject as unfilled", () => {
    const out = resolvePredictFunListLegOutcome(
      [{ orderId: "h1", status: "reject", createAt: 2 } as never],
      Object.assign(new BetResult("PredictFun", true), { orderId: "h1" }),
    );
    expect(out.settlement).toBe("unfilled");
  });

  it("treats pending as timeout", () => {
    const out = resolvePredictFunListLegOutcome(
      [{ orderId: "h1", status: "pending", createAt: 2 } as never],
      Object.assign(new BetResult("PredictFun", true), { orderId: "h1" }),
    );
    expect(out.settlement).toBe("timeout");
  });

  it("does not treat missing orderId as filled", () => {
    const out = resolvePredictFunListLegOutcome(
      [],
      Object.assign(new BetResult("PredictFun", true), { orderId: "h-missing" }),
    );
    expect(out.settlement).toBe("timeout");
  });
});

describe("resolvePredictFunProviderLegOutcome", () => {
  beforeEach(() => {
    pfGetOrder.mockReset();
  });

  it("polls Pf_GetOrder when confirmPostAccepted", async () => {
    pfGetOrder.mockResolvedValue({
      orderId: "0xh",
      found: true,
      settlement: "filled",
      order: {
        provider: "PredictFun",
        orderId: "0xh",
        status: "none",
        createAt: 1,
        odds: 2,
        betMoney: 10,
        reward: 0,
        money: 0,
        game: "",
        match: "1",
        bet: "PredictFun",
        item: "t",
      },
    });
    const getOrders = vi.fn(async () => []);
    const fetchVenueOrders = vi.fn(async () => [
      {
        provider: "PredictFun",
        orderId: "0xh",
        status: "none",
        createAt: 1,
        odds: 2,
        betMoney: 10,
        reward: 0,
        money: 0,
        game: "",
        match: "1",
        bet: "PredictFun",
        item: "t",
      },
    ]);
    const result = Object.assign(new BetResult("PredictFun", true), {
      orderId: "0xh",
      pending: true,
    });
    const out = await resolvePredictFunProviderLegOutcome(
      getOrders,
      { provider: "PredictFun", accountId: 1 } as never,
      result,
      { confirmPostAccepted: true, fetchVenueOrders },
    );
    expect(pfGetOrder).toHaveBeenCalled();
    expect(out.settlement).toBe("filled");
    expect(fetchVenueOrders).toHaveBeenCalled();
    expect(getOrders).not.toHaveBeenCalled();
  });

  it("uses list path when confirmPostAccepted is off", async () => {
    const getOrders = vi.fn(async () => [
      {
        provider: "PredictFun",
        orderId: "0xh",
        status: "none",
        createAt: 1,
        odds: 2,
        betMoney: 10,
        reward: 0,
        money: 0,
        game: "",
        match: "1",
        bet: "PredictFun",
        item: "t",
      },
    ]);
    const result = Object.assign(new BetResult("PredictFun", true), {
      orderId: "0xh",
      pending: true,
    });
    const out = await resolvePredictFunProviderLegOutcome(
      getOrders,
      { provider: "PredictFun", accountId: 1 } as never,
      result,
      {
        orders: [{
          provider: "PredictFun",
          orderId: "0xh",
          status: "reject",
          createAt: 1,
          odds: 2,
          betMoney: 10,
          reward: 0,
          money: 0,
          game: "",
          match: "1",
          bet: "PredictFun",
          item: "t",
        }],
      },
    );
    expect(pfGetOrder).not.toHaveBeenCalled();
    expect(out.settlement).toBe("unfilled");
  });
});
