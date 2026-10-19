import { describe, expect, it, vi, beforeEach } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { iaProvider, mapIaHistoryRow } from "./bet";

const iaMrPost = vi.fn();
vi.mock("./bet_transport", () => ({
  iaMrPost: (...args: unknown[]) => iaMrPost(...args),
  iaBetHeaders: (account: { token?: string }) => ({
    token: account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  }),
  iaGatewayPath: (account: { gateway?: string }, path: string) =>
    `${String(account.gateway ?? "").replace(/\/$/, "")}${path}`,
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  readVenueOdds: vi.fn(() => 0),
  writeVenueOdds: vi.fn(),
}));

vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useMessageStore: () => ({
    limitMessage: () => "超出限红",
  }),
}));

describe("mapIaHistoryRow", () => {
  it("receive_status=2 映射为 reject（对齐 A8 CYe）", () => {
    const order = mapIaHistoryRow(
      {
        order_id: "ia-1",
        odds: 2.1,
        create_time: 1_700_000_000,
        amount: 80,
        desc: "全场独赢TeamA",
        team_name_1: "TeamA",
        team_name_2: "TeamB",
        receive_status: 2,
        game_name: "LOL",
      },
      "IA",
    );
    expect(order.status).toBe("reject");
    expect(order.createAt).toBe(1_700_000_000_000);
    expect(order.match).toBe("TeamA vs TeamB");
  });

  it("receive_status=1 映射为 pending", () => {
    const order = mapIaHistoryRow({ order_id: "p1", receive_status: 1 }, "IA");
    expect(order.status).toBe("pending");
  });
});

describe("iaProvider.getOrders", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ia",
    provider: "IA",
    gateway: "https://ia.example",
    token: "tok",
  });

  beforeEach(() => {
    iaMrPost.mockReset();
  });

  it("无 gateway/token 返回空数组", async () => {
    const bare = { ...account, gateway: "", token: "" } as PlatformAccount;
    await expect(iaProvider.getOrders!(bare)).resolves.toEqual([]);
    expect(iaMrPost).not.toHaveBeenCalled();
  });

  it("pending 时轮询直至无 pending（对齐 A8 CYe 3s 循环）", async () => {
    iaMrPost
      .mockResolvedValueOnce({
        data: {
          data: [{ order_id: "1", receive_status: 1, create_time: 1, desc: "x" }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ order_id: "1", receive_status: 2, create_time: 1, desc: "x" }],
        },
      });

    const orders = await iaProvider.getOrders!(account);
    expect(iaMrPost).toHaveBeenCalledTimes(2);
    expect(orders[0]!.status).toBe("reject");
    expect(iaMrPost.mock.calls[0]![3]).toEqual({ forceDirect: true });
  });
});

describe("iaProvider.getBalance", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ia",
    provider: "IA",
    gateway: "https://ia.example",
    token: "tok",
  });

  beforeEach(() => {
    iaMrPost.mockReset();
  });

  it("对齐 A8 CYe：code=1 返回 Pr.getCurrency + amount", async () => {
    iaMrPost.mockResolvedValue({ code: 1, data: { amount: 123.45 } });
    await expect(iaProvider.getBalance!(account)).resolves.toEqual({
      currency: "CNY",
      balance: 123.45,
    });
  });
});

describe("iaProvider.checkBet", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ia",
    provider: "IA",
    gateway: "https://ia.example",
    token: "tok",
  });

  function makeOption(odds = 1.9) {
    return new BetOption("IA", "m1", "play1", "pt1", 100, "Home", odds);
  }

  const limitOk = { code: 1, data: { money_min: 10, money_max: 5000 } };
  const playsOpen = {
    code: 1,
    data: {
      plays: [
        {
          child_plays: [
            {
              id: "play1",
              status: 1,
              team_points: [{ id: "pt1", status: 1, point: 1.95 }],
            },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    iaMrPost.mockReset();
  });

  it("money_max=0 时返回 limit.msg（A8 CYe）", async () => {
    iaMrPost.mockResolvedValueOnce({ code: 1, data: { money_max: 0 }, msg: "限红无效" });
    const option = makeOption();
    const out = await iaProvider.checkBet!(account, option);
    expect(out.checkError).toBe("限红无效");
    expect(out.request).toMatchObject({
      url: "https://ia.example/api/game/game/getOrdinaryLimitInfo/",
      headers: { token: "tok" },
    });
  });

  it("point.status=2 视为封盘（A8 仅 status===1）", async () => {
    iaMrPost
      .mockResolvedValueOnce(limitOk)
      .mockResolvedValueOnce({
        code: 1,
        data: {
          plays: [
            {
              child_plays: [
                {
                  id: "play1",
                  status: 1,
                  team_points: [{ id: "pt1", status: 2, point: 1.95 }],
                },
              ],
            },
          ],
        },
      });
    const option = makeOption();
    const out = await iaProvider.checkBet!(account, option);
    expect(out.checkError).toBe("盘口已封盘");
  });

  it("赔率下降时返回当前赔率错误", async () => {
    iaMrPost.mockResolvedValueOnce(limitOk).mockResolvedValueOnce(playsOpen);
    const option = makeOption(2.0);
    const out = await iaProvider.checkBet!(account, option);
    expect(out.checkError).toBe("当前赔率:1.95");
    expect(out.newOdds).toBe(1.95);
  });

  it("通过时写入 odd_change_type 载荷（A8 CYe）", async () => {
    iaMrPost.mockResolvedValueOnce(limitOk).mockResolvedValueOnce(playsOpen);
    const option = makeOption(1.9);
    const out = await iaProvider.checkBet!(account, option);
    expect(out.checkError).toBeUndefined();
    expect(out.data).toEqual({
      items: JSON.stringify([{ point_extra_id: "pt1", money: 100, odd: 1.95 }]),
      odd_change_type: 1,
      lang: 1,
    });
    expect(iaMrPost.mock.calls[0]![3]).toEqual({ forceDirect: true });
    expect(iaMrPost.mock.calls[1]![3]).toEqual({ forceDirect: true });
  });
});

describe("iaProvider.betting", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ia",
    provider: "IA",
    gateway: "https://ia.example",
    token: "tok",
  });

  beforeEach(() => {
    iaMrPost.mockReset();
  });

  it("成功时 message 为 res.msg 或空（A8 uo，无中文兜底）", async () => {
    iaMrPost.mockResolvedValue({ code: 1, msg: "ok", data: { status: 1 } });
    const option = new BetOption("IA", "m1", "play1", "pt1", 100, "Home", 1.9);
    option.data = { items: "[]", odd_change_type: 1, lang: 1 };
    const result = await iaProvider.betting!(account, option);
    expect(result.success).toBe(true);
    expect(result.message).toBe("ok");
  });

  it("error 110019 拼接 new_odd 并 updateOdds（A8 CYe）", async () => {
    iaMrPost.mockResolvedValue({
      msg: "fail",
      data: {
        status: 0,
        error: 110019,
        ext: [{ msg: "赔率变更", new_odd: "1.88" }],
      },
    });
    const option = new BetOption("IA", "m1", "play1", "pt1", 100, "Home", 1.9);
    option.data = { items: "[]", odd_change_type: 1, lang: 1 };
    const updateOdds = vi.spyOn(option, "updateOdds");
    const result = await iaProvider.betting!(account, option);
    expect(result.success).toBe(false);
    expect(result.message).toBe("赔率变更1.88");
    expect(updateOdds).toHaveBeenCalledWith(1.88);
  });
});
