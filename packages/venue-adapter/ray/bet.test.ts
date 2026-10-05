import { describe, expect, it, vi, beforeEach } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { rayProvider } from "./bet";

const accountGet = vi.fn();
vi.mock("./accountHttp", () => ({
  accountGet: (...args: unknown[]) => accountGet(...args),
  accountPostForm: vi.fn(),
}));

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  readVenueOdds: vi.fn(() => 0),
  writeVenueOdds: vi.fn(),
}));

vi.mock("../shared/webBridge", () => ({
  useMessageStore: () => ({
    limitMessage: () => "限红",
  }),
}));

function makeOption(odds: number): BetOption {
  return {
    matchId: "m1",
    itemId: "oid-1",
    betMoney: 100,
    odds,
    updateOdds: BetOption.prototype.updateOdds,
    type: "RAY",
  } as unknown as BetOption;
}

function oddsResponse(liveOdds: number) {
  return {
    code: 200,
    result: {
      start_time: "2099-01-01T00:00:00Z",
      odds: [
        {
          odds_id: "oid-1",
          enable_parlay: 1,
          status: 1,
          odds: liveOdds,
          bet_limit: [10, 10_000],
          group_name: "独赢",
          name: "主队",
          match_name: "A vs B",
          match_stage: "全场",
        },
      ],
    },
  };
}

describe("rayProvider.checkBet", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ray",
    provider: "RAY",
    gateway: "https://ray.example",
    token: "t",
  });

  beforeEach(() => {
    accountGet.mockReset();
  });

  it("odds 请求 forceDirect 对齐 A8", async () => {
    accountGet.mockResolvedValue(oddsResponse(1.8));
    await rayProvider.checkBet!(account, makeOption(1.8));
    expect(accountGet).toHaveBeenCalledWith(
      account,
      "/v2/odds?match_id=m1",
      { forceDirect: true },
    );
  });

  it("客户端赔率高于场馆超过 0.01 时不写 data（对齐 A8 vYe）", async () => {
    accountGet.mockResolvedValue(oddsResponse(1.5));
    const option = makeOption(2);
    const out = await rayProvider.checkBet!(account, option);
    expect(out.data).toBeUndefined();
    expect(out.checkError).toContain("赔率下降");
    expect(out.checkError).toContain("检测赔率 2，当前赔率 1.5");
  });

  it("盘口接口业务失败保留响应并给出原因，不误报无盘口数据", async () => {
    const response = { code: 401, desc: "token=SECRET" };
    accountGet.mockResolvedValue(response);
    const out = await rayProvider.checkBet!(account, makeOption(1.8));
    expect(out.data).toBeUndefined();
    expect(out.response).toBe(response);
    expect(out.checkError).toBe("RAY 盘口请求失败");
    expect(out.checkError).not.toContain("SECRET");
  });

  it("滑点允许范围内写入 data 且 odds 取场馆价", async () => {
    accountGet.mockResolvedValue(oddsResponse(1.88));
    const option = makeOption(1.89);
    const out = await rayProvider.checkBet!(account, option);
    expect(out.data).toBeDefined();
    expect(out.odds).toBe(1.88);
    const order = (out.data as { order: Array<{ order_detail: { odds: number } }> }).order[0];
    expect(order.order_detail.odds).toBe(1.88);
  });

  it("下单 payload 只保留官网提交字段，不携带预检快照字段", async () => {
    accountGet.mockResolvedValue(oddsResponse(1.88));
    const out = await rayProvider.checkBet!(account, makeOption(1.88));
    expect(out.data).toEqual({
      total_stake: "100",
      order: [
        {
          title: "独赢\n主队",
          order_type: 0,
          stake: "100",
          order_detail: {
            odds_id: "oid-1",
            odds: 1.88,
            title: "独赢\n主队",
            match_name: "A vs B",
            match_stage: "全场",
          },
        },
      ],
    });
  });
});

describe("rayProvider.getOrders", () => {
  const account = new PlatformAccount({
    accountId: 2,
    playerName: "ray2",
    provider: "RAY",
    gateway: "https://ray.example",
    token: "t",
  });

  beforeEach(() => {
    accountGet.mockReset();
  });

  it("status=4 映射为 reject（对齐 A8 vYe）", async () => {
    accountGet.mockResolvedValue({
      code: 200,
      result: [
        {
          order_number: "R-1",
          status: 4,
          win: 0,
          total_bonus: 0,
          create_time: "2024-01-01 12:00:00",
          detail: [
            {
              title: "独赢\n主队",
              odds: 1.85,
              stake: 50,
              game_id: 1,
              match_name: "A vs B",
              match_stage: "全场",
            },
          ],
        },
      ],
    });
    const orders = await rayProvider.getOrders!(account);
    expect(orders[0]!.status).toBe("reject");
    expect(orders[0]!.orderId).toBe("R-1");
  });

  it("status=1 win=0 maps to lose", async () => {
    accountGet.mockResolvedValue({
      code: 200,
      result: [
        {
          order_number: "R-lose",
          status: 1,
          win: 0,
          total_bonus: 0,
          create_time: "2024-01-01 12:00:00",
          detail: [{ title: "独赢\n主队", odds: 1.85, stake: 50, match_name: "A vs B", match_stage: "全场" }],
        },
      ],
    });
    const orders = await rayProvider.getOrders!(account);
    expect(orders[0]!.status).toBe("lose");
    expect(orders[0]!.money).toBe(-50);
  });

  it("按 createAt 降序，拒单检测取首条（对齐 A8 isVenueReject）", async () => {
    accountGet.mockResolvedValue({
      code: 200,
      result: [
        {
          order_number: "old-win",
          status: 1,
          win: 0,
          total_bonus: 100,
          create_time: "2024-01-01 10:00:00",
          detail: [
            {
              title: "独赢\n主队",
              odds: 1.5,
              stake: 100,
              game_id: 1,
              match_name: "A vs B",
              match_stage: "全场",
            },
          ],
        },
        {
          order_number: "new-reject",
          status: 4,
          win: 0,
          total_bonus: 0,
          create_time: "2024-01-01 12:00:00",
          detail: [
            {
              title: "独赢\n客队",
              odds: 2.1,
              stake: 80,
              game_id: 1,
              match_name: "A vs B",
              match_stage: "全场",
            },
          ],
        },
      ],
    });
    const orders = await rayProvider.getOrders!(account);
    expect(orders[0]!.orderId).toBe("new-reject");
    expect(orders[0]!.status).toBe("reject");
  });
});
