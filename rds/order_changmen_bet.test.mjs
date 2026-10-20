import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BET_LOG_AFTER_MS,
  BET_LOG_BEFORE_MS,
  isSuccessBetLogTitle,
  isSuccessCheckLogTitle,
  matchChangmenBetFromLogs,
} from "./order_changmen_bet.js";

describe("order_changmen_bet", () => {
  const createAt = 1_781_890_577_200;
  const matchTitle = "Vitality vs Falcons";

  it("isSuccessBetLogTitle detects changmen bet success", () => {
    assert.equal(isSuccessBetLogTitle("[OB](星空,4) 下注 => true / 耗时:114ms"), true);
    assert.equal(isSuccessBetLogTitle("[RAY] 下注 => false / 耗时:345ms"), false);
  });

  it("isSuccessCheckLogTitle detects pre-check success", () => {
    assert.equal(
      isSuccessCheckLogTitle("[OB](星空,4) 请求盘口数据 => true / 耗时12ms / 2.1:2.1"),
      true,
    );
    assert.equal(
      isSuccessCheckLogTitle("[OB](星空,4) 请求盘口数据 => false / 耗时12ms"),
      false,
    );
  });

  it("matches provider and time window", () => {
    const logs = [
      {
        title: "[OB](星空,4) 下注 => true / 耗时:114ms",
        data: JSON.stringify({
          result: { provider: "OB", success: true },
          options: { betMoney: 60, odds: 2.652 },
        }),
        create_at: createAt + 72,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        { provider: "OB", create_at: createAt, bet_money: 60, odds: 2.652 },
        logs,
      ),
      true,
    );
    assert.equal(
      matchChangmenBetFromLogs({ provider: "RAY", create_at: createAt }, logs),
      false,
    );
  });

  it("matches bet log by orderId even when money differs", () => {
    const logs = [
      {
        title: "[PB](平,1) 下注 => true",
        data: JSON.stringify({
          result: { provider: "PB", success: true, orderId: "pb-order-99" },
        }),
        create_at: createAt,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        {
          order_id: "pb-order-99",
          provider: "PB",
          create_at: createAt,
          bet_money: 60,
          odds: 1.9,
        },
        logs,
      ),
      true,
    );
  });

  it("rejects bet money mismatch when matching by provider", () => {
    const logs = [
      {
        title: "[OB](星空,4) 下注 => true",
        data: JSON.stringify({ options: { betMoney: 100, odds: 2.652 } }),
        create_at: createAt,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        { provider: "OB", create_at: createAt, bet_money: 60, odds: 2.652 },
        logs,
      ),
      false,
    );
  });

  it("rejected venue order still matches prior bet success log", () => {
    const logs = [
      {
        title: "[PB](平,1) 下注 => true / 耗时:200ms",
        data: JSON.stringify({
          result: { provider: "PB", success: true, orderId: "pb-reject-1" },
        }),
        create_at: createAt - 30_000,
      },
      {
        title: "[PB] - pb-reject-1 拒单检测 => REJECTED",
        data: "[]",
        create_at: createAt + 5_000,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        {
          order_id: "pb-reject-1",
          provider: "PB",
          create_at: createAt,
          status: "Reject",
        },
        logs,
      ),
      true,
    );
  });

  it("falls back to successful pre-check when bet log missing", () => {
    const logs = [
      {
        title: "[OB](星空,4) 请求盘口数据 => true / 耗时10ms / 2.6:2.6",
        data: JSON.stringify({
          options: {
            type: "OB",
            match: matchTitle,
            betMoney: 60,
            odds: 2.652,
          },
        }),
        create_at: createAt - 2000,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        {
          provider: "OB",
          create_at: createAt,
          match: matchTitle,
          bet_money: 60,
          odds: 2.652,
        },
        logs,
      ),
      true,
    );
  });

  it("does not fallback to pre-check with wrong match title", () => {
    const logs = [
      {
        title: "[OB](星空,4) 请求盘口数据 => true",
        data: JSON.stringify({
          options: {
            type: "OB",
            match: "Other Match",
            betMoney: 60,
            odds: 2.652,
          },
        }),
        create_at: createAt,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs(
        {
          provider: "OB",
          create_at: createAt,
          match: matchTitle,
          bet_money: 60,
          odds: 2.652,
        },
        logs,
      ),
      false,
    );
  });

  it("respects time window constants", () => {
    const logs = [
      {
        title: "[OB] 下注 => true",
        data: "{}",
        create_at: createAt - BET_LOG_BEFORE_MS - 1,
      },
    ];
    assert.equal(
      matchChangmenBetFromLogs({ provider: "OB", create_at: createAt }, logs),
      false,
    );
    logs[0].create_at = createAt + BET_LOG_AFTER_MS + 1;
    assert.equal(
      matchChangmenBetFromLogs({ provider: "OB", create_at: createAt }, logs),
      false,
    );
  });
});
