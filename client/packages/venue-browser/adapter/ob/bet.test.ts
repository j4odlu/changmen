import { describe, expect, it, vi, beforeEach } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { obProvider } from "./bet";

const accountGet = vi.fn();
const accountPostForm = vi.fn();
vi.mock("./accountHttp", () => ({
  accountGet: (...args: unknown[]) => accountGet(...args),
  accountPostForm: (...args: unknown[]) => accountPostForm(...args),
}));

vi.mock("@changmen/client-core/shared/md5", () => ({
  md5: (s: string) => `md5:${s}`,
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn().mockResolvedValue(undefined),
}));

function makeOption(): BetOption {
  return {
    matchId: "m1",
    betId: "b1",
    itemId: "i1",
    betMoney: 100,
    odds: 1.85,
    updateOdds: vi.fn(),
    type: "OB",
    data: null,
  } as unknown as BetOption;
}

describe("obProvider.getBalance", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ob",
    provider: "OB",
    gateway: "https://ob.example",
    token: "tok",
  });

  beforeEach(() => {
    accountGet.mockReset();
    accountGet.mockImplementation(async (_acc, path) => {
      if (path === "/game/balance") {
        return { status: "true", data: { balance: 88, currency_en: "CNY", uid: "u1", account: "quan10um" } };
      }
      if (String(path).includes("/game/odd/updateType")) {
        return { status: "true", data: "2" };
      }
      if (path === "/game/member/heartbeat") {
        return { status: "true" };
      }
      return {};
    });
  });

  it("无 gateway/token 前置守卫，status=true 时返回余额（对齐 A8 yYe）", async () => {
    const bare = { ...account, gateway: "", token: "" } as PlatformAccount;
    const bal = await obProvider.getBalance!(bare);
    expect(bal).toEqual({
      balance: 88,
      currency: "CNY",
      venueMemberId: "u1",
      venueAccountName: "quan10um",
    });
    expect(accountGet).toHaveBeenCalledWith(bare, "/game/balance");
  });

  it("heartbeat 失败仍返回已拉到的余额（避免定时刷新误显 TOKEN ERROR）", async () => {
    accountGet.mockImplementation(async (_acc, path) => {
      if (path === "/game/balance") {
        return { status: "true", data: { balance: 12, currency_en: "CNY", uid: "u1", account: "a" } };
      }
      if (String(path).includes("/game/odd/updateType")) {
        return { status: "true", data: "2" };
      }
      if (path === "/game/member/heartbeat") {
        throw new Error("network reset");
      }
      return {};
    });
    const bal = await obProvider.getBalance!(account);
    expect(bal?.balance).toBe(12);
  });

  it("balance status!=true 时抛出场馆文案", async () => {
    accountGet.mockResolvedValue({ status: "false", data: "redis: nil" });
    await expect(obProvider.getBalance!(account)).rejects.toThrow(/redis:\s*nil/);
  });
});

describe("obProvider.checkBet", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ob",
    provider: "OB",
    gateway: "https://ob.example",
    token: "tok",
  });

  beforeEach(() => {
    accountGet.mockReset();
    accountPostForm.mockReset();
    account.errorCount = 0;
  });

  it("探针与下单 data 共用同一 time_stamp / secret_key（对齐 A8 yYe）", async () => {
    accountPostForm.mockResolvedValue({ status: "false", data: "Minimum stake 10" });
    const option = makeOption();
    await obProvider.checkBet!(account, option);

    expect(accountPostForm).toHaveBeenCalledTimes(1);
    const probeBody = accountPostForm.mock.calls[0]![2] as Record<string, unknown>;
    const data = option.data as Record<string, unknown>;
    expect(data.time_stamp).toBe(probeBody.time_stamp);
    expect(data.secret_key).toBe(probeBody.secret_key);
    expect(data["b[0]"]).toMatch(/a=100&/);
  });

  it("非 Minimum 探针响应一律预检失败（对齐 A8 yYe，不看 status）", async () => {
    accountPostForm.mockResolvedValue({ status: "true", data: "ok" });
    const option = makeOption();
    const out = await obProvider.checkBet!(account, option);
    expect(out.data).toBeFalsy();
    expect(out.checkError).toBe("ok");
  });

  it("再预检就是同一注单重复提交：场馆判重复则无冻价可下", async () => {
    const sent: string[] = [];
    accountPostForm.mockImplementation(async (_acc, _path, body: Record<string, string>) => {
      const line = String(body["b[0]"]);
      const duplicated = sent.includes(line);
      sent.push(line);
      return duplicated
        ? { status: "false", data: "请勿重复提交" }
        : { status: "false", data: "Minimum stake 10" };
    });

    const option = makeOption();
    const first = await obProvider.checkBet!(account, option);
    expect(first.data).toBeDefined();

    option.data = null;
    const second = await obProvider.checkBet!(account, option);

    expect(sent).toEqual([sent[0], sent[0]]);
    expect(second.data).toBeNull();
    expect(second.checkError).toBe("请勿重复提交");
  });

  it("补单（loseOrder）不打探测单，直接写冻价", async () => {
    const option = makeOption();
    option.loseOrder = true;

    const out = await obProvider.checkBet!(account, option);

    expect(accountPostForm).not.toHaveBeenCalled();
    expect(out.data).toBeDefined();
  });

  it("Minimum 后继续写 data 且不递归预检", async () => {
    accountPostForm.mockResolvedValue({ status: "false", data: "Minimum stake" });
    const option = makeOption();
    const out = await obProvider.checkBet!(account, option);
    expect(accountPostForm).toHaveBeenCalledTimes(1);
    expect(out.data).toBeDefined();
    expect(out.newOdds).toBe(0);
  });
});

describe("obProvider.getOrders", () => {
  const account = new PlatformAccount({
    accountId: 3,
    playerName: "ob3",
    provider: "OB",
    gateway: "https://ob.example",
    token: "tok",
  });

  beforeEach(() => {
    accountGet.mockReset();
  });

  it("bet_status=2 映射为 reject（对齐 A8 yYe）", async () => {
    accountGet.mockImplementation(async (_acc, path) => {
      const p = String(path);
      if (p.includes("status=1")) {
        return { status: "true", data: { bet: [] } };
      }
      if (p.includes("status=2")) {
        return {
          status: "true",
          data: {
            bet: [
              {
                id: "99",
                bet_status: 2,
                odd: 1.9,
                bet_time: 1_700_000_000_000,
                bet_amount: 100,
                win_amount: 0,
                team_cn_names: "A,B",
                round: 0,
                market_cn_name: "独赢",
                odd_name: "A",
                game_id: "1",
              },
            ],
          },
        };
      }
      return {};
    });

    const orders = await obProvider.getOrders!(account);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe("reject");
    expect(orders[0]!.orderId).toBe("99");
  });
});

describe("obProvider.betting", () => {
  const account = new PlatformAccount({
    accountId: 2,
    playerName: "ob2",
    provider: "OB",
    gateway: "https://ob.example",
    token: "tok",
  });

  beforeEach(() => {
    accountPostForm.mockReset();
  });

  it("成功 message 使用场馆 res.data（对齐 A8 uo）", async () => {
    accountPostForm.mockResolvedValue({ status: "true", data: "下注成功" });
    const option = makeOption();
    option.data = {
      c: 1,
      "b[0]": "mch=m1&mkt=b1&oid=i1&odd=1.850&a=100&bt=1",
      types: 1,
      time_stamp: 123,
      secret_key: "k",
    };
    const result = await obProvider.betting!(account, option);
    expect(result.success).toBe(true);
    expect(result.message).toBe("下注成功");
  });
});
