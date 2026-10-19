import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { BetOption } from "@changmen/client-core/models/betOption";
import { pbProvider } from "./bet";
import { setPbLineId } from "./lineCache";
import { pbRejectStorageKey } from "./rejectPoll";

const pbPost = vi.fn();
vi.mock("./transport", () => ({
  pbPost: (...args: unknown[]) => pbPost(...args),
}));

const sessionMock = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => sessionMock.get(k) ?? null,
  setItem: (k: string, v: string) => {
    sessionMock.set(k, v);
  },
  removeItem: (k: string) => {
    sessionMock.delete(k);
  },
  clear: () => sessionMock.clear(),
});

describe("pbProvider.getOrders", () => {
  const account = new PlatformAccount({
    accountId: 7,
    playerName: "pb",
    provider: "PB",
    gateway: "https://pb.example",
    token: "{}",
    multiply: 1,
  });

  beforeEach(() => {
    pbPost.mockReset();
    pbPost.mockResolvedValue([]);
    sessionMock.clear();
  });

  afterEach(() => {
    sessionMock.clear();
  });

  it("合并 sessionStorage 拒单缓存（对齐 A8 SQ）", async () => {
    const key = pbRejectStorageKey(account);
    sessionMock.set(
      key,
      JSON.stringify({
        provider: "PB",
        orderId: "pending-1",
        odds: 1.9,
        createAt: 999,
        betMoney: 100,
        reward: 0,
        money: 0,
        status: "reject",
        game: "LOL",
        match: "A vs B",
        bet: "全场",
        item: "A",
      }),
    );

    const orders = await pbProvider.getOrders!(account);
    expect(orders.some((o) => o.orderId === "pending-1" && o.status === "reject")).toBe(true);
  });
});

describe("pbProvider.getBalance", () => {
  beforeEach(() => {
    pbPost.mockReset();
  });

  it("余额成功时附带 token 解析的 venueMemberId / venueAccountName", async () => {
    const udata = Buffer.from(JSON.stringify({
      userCode: "JJJ010016S",
      loginId: "bttes2_47104",
    })).toString("base64");
    const account = new PlatformAccount({
      accountId: 9,
      playerName: "pb-bal",
      provider: "PB",
      gateway: "https://pb.example",
      token: JSON.stringify({
        "x-app-data": JSON.stringify({
          BrowserSessionId_1228: "sess",
          custid_1228: "id%3DJJJ010016S%26login%3D1",
        }),
        __udata: udata,
      }),
      multiply: 1,
    });
    pbPost.mockResolvedValue({ success: true, betCredit: 10, currency: "CNY" });
    const bal = await pbProvider.getBalance!(account);
    expect(bal?.balance).toBe(10);
    expect(bal?.venueMemberId).toBe("JJJ010016S");
    expect(bal?.venueAccountName).toBe("bttes2_47104");
  });
});

describe("pbProvider.checkBet", () => {
  const account = new PlatformAccount({
    accountId: 8,
    playerName: "pb-check",
    provider: "PB",
    gateway: "https://pb.example",
    token: "{}",
    multiply: 1,
  });

  beforeEach(() => {
    pbPost.mockReset();
  });

  it("赔率下降时返回明确预检错误", async () => {
    setPbLineId("bet-odds-drop", 123);
    pbPost.mockResolvedValue([
      {
        status: "AVAILABLE",
        minStake: 1,
        maxStake: 1000,
        odds: 2,
        lineId: 456,
      },
    ]);

    const option = new BetOption(
      "PB",
      "match-1",
      "bet-odds-drop",
      "a|b|c|d|e|f|g",
      100,
      "Away",
      2.05,
    );
    const checked = await pbProvider.checkBet!(account, option);

    expect(checked.data).toBeNull();
    expect(checked.checkError).toBe("赔率下降 2 < 2.05");
  });

  it("Sources.LineID 可在无 lineCache 时预检", async () => {
    pbPost.mockResolvedValue([
      {
        status: "AVAILABLE",
        minStake: 1,
        maxStake: 1000,
        odds: 1.91,
        lineId: 42,
      },
    ]);
    const option = new BetOption(
      "PB",
      "1633896380",
      "1633896380:0",
      "1633896380|0|1|0|0|0|0",
      50,
      "Home",
      1.9,
    );
    option.item = { lineId: 42 } as BetOption["item"];
    const checked = await pbProvider.checkBet!(account, option);
    expect(checked.checkError).toBeUndefined();
    expect(checked.data).toBeTruthy();
    expect(pbPost.mock.calls[0]![2].oddsSelections[0].selectionId).toBe(
      "42|1633896380|0|1|0|0|0|0",
    );
  });
});
