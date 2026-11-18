import { describe, expect, it } from "vitest";
import { dailyBetProfit, settledRoi, sumBetProfitRows, userBetProfit } from "./adminBetProfit";

const row = (overrides = {}) => ({
  provider: "OB", total_orders: 4, wins: 1, losses: 1, rejects: 1, returns: 0,
  pending: 1, total_bet: 500, total_profit: 30, settled_orders: 2,
  settled_bet: 200, settled_profit: 20, pending_bet: 300, avg_odds: 2,
  ...overrides,
});

describe("strategy profit summaries", () => {
  it("separates users with identical names and combines their own accounts with weighted ROI", () => {
    const account = { ...row(), user_id: "u1", user_name: "同名用户", player_id: 1, account_name: "同名账号", account_deleted: false };
    const users = userBetProfit([
      account,
      { ...account, player_id: 2, account_deleted: true, settled_bet: 100, settled_profit: -5.25 },
      { ...account, user_id: "u2", total_profit: -8 },
      { ...account, user_id: "deleted", user_name: null, player_id: null, total_profit: 0 },
    ]);
    expect(users.map(r => r.user_id)).toEqual(["u1", "deleted", "u2"]);
    expect(users[0]).toMatchObject({ account_count: 2, total_orders: 8, total_profit: 60, settled_bet: 300, settled_profit: 14.75 });
    expect(settledRoi(users[0])).toBeCloseTo(14.75 / 300 * 100);
    expect(users[1]).toMatchObject({ user_name: "deleted", account_count: 0 });
    expect(userBetProfit([])).toEqual([]);
  });
  it("uses settled capital, excludes open-position profit from ROI, and preserves money precision", () => {
    const total = sumBetProfitRows([row(), row({ provider: "RAY", settled_bet: 100, settled_profit: -5.25 })]);
    expect(total.settled_profit).toBe(14.75);
    expect(total.pending_bet).toBe(600);
    expect(settledRoi(total)).toBeCloseTo(14.75 / 300 * 100);
    expect(total.total_profit).toBe(60);
  });
  it("shows no ROI for an empty or entirely pending selection", () => {
    expect(settledRoi(sumBetProfitRows([]))).toBeNull();
    expect(settledRoi(row({ settled_bet: 0 }))).toBeNull();
  });
  it("weights odds by order count", () => {
    expect(sumBetProfitRows([row({ total_orders: 1, avg_odds: 4 }), row({ total_orders: 3, avg_odds: 2 })]).avg_odds).toBe(2.5);
  });
  it("sorts days, combines providers and recomputes cumulative profit for a provider filter", () => {
    const rows = [
      { ...row({ total_profit: -20 }), day: "2026-11-18" },
      { ...row({ total_profit: 10 }), day: "2026-11-17" },
      { ...row({ provider: "RAY", total_profit: 50 }), day: "2026-11-17" },
    ];
    expect(dailyBetProfit(rows).map(r => [r.day, r.total_profit, r.cumulative_profit]))
      .toEqual([["2026-11-17", 60, 60], ["2026-11-18", -20, 40]]);
    expect(dailyBetProfit(rows, "OB").map(r => r.cumulative_profit)).toEqual([10, -10]);
    expect(dailyBetProfit(rows, "missing")).toEqual([]);
  });
});
