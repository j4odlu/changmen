import { describe, expect, test } from "vitest";
import {
  STAKE_USDT_TO_CNY,
  mapStakeOrderRow,
  mapStakeOrderStatus,
  readStakeSessionToken,
  stakeLimitExceeded,
} from "./bet";
import { stakeAccountHeaders } from "./pluginApi";

describe("mapStakeOrderStatus", () => {
  test("maps settled win/lose/return", () => {
    expect(mapStakeOrderStatus("settled", 10, 20)).toBe("win");
    expect(mapStakeOrderStatus("settled", 10, 5)).toBe("lose");
    expect(mapStakeOrderStatus("settled", 10, 10)).toBe("return");
  });

  test("maps reject and pending", () => {
    expect(mapStakeOrderStatus("cancelpending", 10, 0)).toBe("reject");
    expect(mapStakeOrderStatus("pending", 10, 0)).toBe("pending");
  });
});

describe("mapStakeOrderRow", () => {
  test("converts USDT amounts to CNY fields", () => {
    const row = mapStakeOrderRow({
      id: "bet-1",
      status: "settled",
      amount: 2,
      payout: 4,
      createdAt: "2026-01-01T00:00:00.000Z",
      outcomes: [
        {
          odds: 1.95,
          outcome: { name: "Team A" },
          market: { name: "Match Winner" },
          fixture: {
            name: "A vs B",
            tournament: { category: { sport: { slug: "counter-strike" } } },
          },
        },
      ],
    });

    expect(row.provider).toBe("Stake");
    expect(row.orderId).toBe("bet-1");
    expect(row.odds).toBe(1.95);
    expect(row.betMoney).toBeCloseTo(2 * STAKE_USDT_TO_CNY);
    expect(row.reward).toBeCloseTo(4 * STAKE_USDT_TO_CNY);
    expect(row.money).toBeCloseTo(2 * STAKE_USDT_TO_CNY);
    expect(row.status).toBe("win");
    expect(row.game).toBe("counter-strike");
    expect(row.item).toBe("Team A");
  });
});

describe("stakeLimitExceeded", () => {
  test("respects expiry and value", () => {
    expect(stakeLimitExceeded({ value: 100, expireTime: Date.now() + 60_000 }, 50)).toBe(false);
    expect(stakeLimitExceeded({ value: 100, expireTime: Date.now() + 60_000 }, 150)).toBe(true);
    expect(stakeLimitExceeded({ value: 100, expireTime: Date.now() - 1 }, 150)).toBe(false);
  });
});

describe("stakeAccountHeaders", () => {
  test("matches A8 im() betting headers", () => {
    expect(stakeAccountHeaders({ token: "sess" })).toEqual({
      "content-type": "application/json",
      "x-language": "zh",
      "x-operation-name": "CurrencyConfiguration",
      "x-operation-type": "query",
      "x-access-token": "sess",
    });
    expect(stakeAccountHeaders({ token: "" })).toEqual({
      "content-type": "application/json",
      "x-language": "zh",
      "x-operation-name": "CurrencyConfiguration",
      "x-operation-type": "query",
    });
  });
});

describe("readStakeSessionToken", () => {
  test("trims account.token", () => {
    expect(readStakeSessionToken({ token: "  abc  " })).toBe("abc");
    expect(readStakeSessionToken({ token: "" })).toBe("");
  });
});
