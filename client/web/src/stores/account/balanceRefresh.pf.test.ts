import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { BetResult } from "@changmen/client-core/models/betResult";
import { applyPmBalanceRejection, invalidatePmBalanceQueries } from "@/domain/polymarket/pmBalanceRejection";

const updateBalance = vi.hoisted(() => vi.fn(async () => ({ total: 100, platformId: 1, platformName: "PredictFun" })));
const refreshPfBalance = vi.hoisted(() => vi.fn(async () => ({
  balance: 88.5,
  currency: "USDT",
  totalProfit: 1.2,
  unsettle: 0,
  orderCount: 3,
})));
const getBalance = vi.hoisted(() => vi.fn());
const fetchPolymarketBalanceViaTransport = vi.hoisted(() => vi.fn());
const pmAccountShowsUnlockPending = vi.hoisted(() => vi.fn(() => false));
const fetchObSportAmountForAccount = vi.hoisted(() => vi.fn());

vi.mock("@/api/vt", () => ({
  updateBalance,
}));

vi.mock("@/api/account", () => ({
  refreshPfBalance,
  refreshPmBalance: vi.fn(),
}));

vi.mock("@/runtime/obSportAmount", () => ({
  fetchObSportAmountForAccount: (...args: unknown[]) => fetchObSportAmountForAccount(...args),
}));

vi.mock("@/runtime/venueAdapters", () => ({
  getAdapter: () => ({
    provider: { getBalance },
  }),
}));

vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  fetchPolymarketBalanceViaTransport: (...args: unknown[]) => fetchPolymarketBalanceViaTransport(...args),
}));

vi.mock("@/security/pmVault", () => ({
  normalizePmVaultUserId: (v: unknown) => String(v || ""),
  pmAccountShowsUnlockPending,
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ userId: "u1" }),
}));

vi.mock("@/stores/messageStore", () => ({
  useMessageStore: () => ({
    balanceMessage: vi.fn(),
    profitMessage: vi.fn(),
  }),
}));

describe("refreshAccountBalance PredictFun", () => {
  beforeEach(() => {
    updateBalance.mockClear();
    refreshPfBalance.mockClear();
    getBalance.mockReset();
    pmAccountShowsUnlockPending.mockReturnValue(false);
  });

  it("reads official USDT via provider.getBalance and never Client_UpdateBalance", async () => {
    getBalance.mockResolvedValue({ balance: 1.06, currency: "USDT" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 42,
      playerName: "pf",
      provider: "PredictFun",
    });

    await refreshAccountBalance({} as never, acc);

    expect(getBalance).toHaveBeenCalled();
    expect(refreshPfBalance).not.toHaveBeenCalled();
    expect(acc.balance).toBe(1.06);
    expect(acc.currency).toBe("USDT");
    expect(updateBalance).not.toHaveBeenCalled();
  });

  it("skips balance when vault unlock pending", async () => {
    pmAccountShowsUnlockPending.mockReturnValue(true);
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 42,
      playerName: "pf",
      provider: "PredictFun",
    });
    acc.balance = 9;

    await refreshAccountBalance({} as never, acc);

    expect(getBalance).not.toHaveBeenCalled();
    expect(acc.balance).toBeUndefined();
  });
});

describe("refreshAccountBalance Polymarket", () => {
  beforeEach(() => {
    updateBalance.mockClear();
    getBalance.mockReset();
    fetchPolymarketBalanceViaTransport.mockReset();
    pmAccountShowsUnlockPending.mockReturnValue(false);
  });

  it("uses direct-first transport and persists the returned balance once", async () => {
    fetchPolymarketBalanceViaTransport.mockResolvedValue({ balance: 12.5, currency: "USDT" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 47,
      playerName: "pm",
      provider: "Polymarket",
      token: "token",
    });

    await refreshAccountBalance({} as never, acc);

    expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledWith(acc);
    expect(getBalance).not.toHaveBeenCalled();
    expect(acc.balance).toBe(12.5);
    expect(acc.currency).toBe("USDT");
    expect(updateBalance).toHaveBeenCalledTimes(1);
    expect(updateBalance).toHaveBeenCalledWith(47, 12.5);
  });

  it("keeps the last good balance when both direct and VPS transport fail", async () => {
    fetchPolymarketBalanceViaTransport.mockRejectedValue(new Error("PM transport unavailable"));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 48,
      playerName: "pm",
      provider: "Polymarket",
      token: "token",
    });
    acc.balance = 9;

    await refreshAccountBalance({} as never, acc);

    expect(acc.balance).toBe(9);
    expect(acc.balanceStale).toBe(true);
    expect(updateBalance).not.toHaveBeenCalled();
  });
});

describe("refreshAccountBalance keep last good", () => {
  beforeEach(() => {
    updateBalance.mockClear();
    getBalance.mockReset();
    pmAccountShowsUnlockPending.mockReturnValue(false);
  });

  it("keeps previous balance and marks stale on transient failure", async () => {
    getBalance.mockRejectedValue(new Error("network reset"));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 7,
      playerName: "ob",
      provider: "OB",
      gateway: "https://ob.example",
      token: "tok",
    });
    acc.balance = 55;

    await refreshAccountBalance({} as never, acc);
    expect(acc.balance).toBe(55);
    expect(acc.balanceStale).toBe(true);
  });

  it("clears balance on auth failure even if previous balance exists", async () => {
    getBalance.mockRejectedValue(new Error("redis: nil"));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 9,
      playerName: "ob",
      provider: "OB",
      gateway: "https://ob.example",
      token: "tok",
    });
    acc.balance = 55;

    await refreshAccountBalance({} as never, acc);
    expect(acc.balance).toBeUndefined();
    expect(acc.balanceStale).toBe(false);
    expect(acc.errorCount).toBe(1);
  });

  it("leaves balance undefined when never loaded and refresh fails", async () => {
    getBalance.mockResolvedValue(undefined);
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 8,
      playerName: "ob",
      provider: "OB",
      gateway: "https://ob.example",
      token: "tok",
    });
    expect(acc.balance).toBeUndefined();

    await refreshAccountBalance({} as never, acc);
    expect(acc.balance).toBeUndefined();
    expect(acc.balanceStale).toBe(false);
  });

  it("clears stale flag after successful refresh", async () => {
    getBalance.mockResolvedValue({ balance: 66, currency: "CNY" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 10,
      playerName: "ob",
      provider: "OB",
      gateway: "https://ob.example",
      token: "tok",
    });
    acc.balance = 55;
    acc.balanceStale = true;

    await refreshAccountBalance({} as never, acc);
    expect(acc.balance).toBe(66);
    expect(acc.balanceStale).toBe(false);
  });
});

describe("isVenueAuthFailureMessage", () => {
  it("detects OB redis nil and PB session codes", async () => {
    const { isVenueAuthFailureMessage } = await import("./balanceRefresh");
    expect(isVenueAuthFailureMessage("redis: nil")).toBe(true);
    expect(isVenueAuthFailureMessage("MULTIPLE_LOGIN")).toBe(true);
    expect(isVenueAuthFailureMessage("SESSION")).toBe(true);
    expect(isVenueAuthFailureMessage("token error")).toBe(true);
    expect(isVenueAuthFailureMessage("network reset")).toBe(false);
    // 勿把 HTTP 正文里的 Forbidden 误判成鉴权失效
    expect(isVenueAuthFailureMessage("Request failed with status code 403 Forbidden")).toBe(false);
    expect(isVenueAuthFailureMessage("PB 官网标签页暂时不可用")).toBe(false);
    expect(isVenueAuthFailureMessage("PB 官网标签页暂时不可用（未找到 https://skin.example/ 的登录页，请打开并刷新该站后重试）")).toBe(false);
  });
});

const SPORT_HEX = "4be9f09298fe183b0cc029d3db4b32d1cc2d8d89";

describe("refreshAccountBalance OB sport wallet", () => {
  beforeEach(() => {
    updateBalance.mockClear();
    getBalance.mockReset();
    fetchObSportAmountForAccount.mockReset();
    fetchObSportAmountForAccount.mockResolvedValue(9999882);
  });

  it("writes yewu12 into sportBalance on /sports and never Client_UpdateBalance", async () => {
    const { refreshAccountBalance } = await import("./balanceRefresh");
    vi.stubGlobal("location", { pathname: "/sports/football" });
    try {
      const acc = new PlatformAccount({
        accountId: 21,
        playerName: "ob-sport",
        provider: "OB",
        sportOb: {
          token: SPORT_HEX,
          gateway: "https://user-pc-new.dbgaming.com",
          referer: "https://user-pc-new.dbgaming.com/",
          venueMemberId: "1009139033518055424",
        },
      });
      acc.balance = 12;

      await refreshAccountBalance({} as never, acc);

      expect(fetchObSportAmountForAccount).toHaveBeenCalled();
      expect(getBalance).not.toHaveBeenCalled();
      expect(updateBalance).not.toHaveBeenCalled();
      expect(acc.sportBalance).toBe(9999882);
      expect(acc.balance).toBe(12);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps esport /game/balance when an esport token exists off the sports page", async () => {
    const { refreshAccountBalance } = await import("./balanceRefresh");
    getBalance.mockResolvedValue({ balance: 0, currency: "CNY" });
    const acc = new PlatformAccount({
      accountId: 22,
      playerName: "ob-both",
      provider: "OB",
      token: "1234567890123456789",
      sportOb: { token: SPORT_HEX, venueMemberId: "1009139033518055424" },
    });
    acc.sportBalance = 9999882;

    await refreshAccountBalance({} as never, acc);

    expect(fetchObSportAmountForAccount).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalled();
    expect(updateBalance).toHaveBeenCalledWith(22, 0);
    expect(acc.balance).toBe(0);
    expect(acc.sportBalance).toBe(9999882);
  });

  it("skips yewu12 and /game/balance for sport-only accounts on the esport page", async () => {
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const acc = new PlatformAccount({
      accountId: 24,
      playerName: "ob-sport",
      provider: "OB",
      sportOb: { token: SPORT_HEX, venueMemberId: "1009139033518055424" },
    });
    acc.balance = 7;

    await refreshAccountBalance({} as never, acc);

    expect(fetchObSportAmountForAccount).not.toHaveBeenCalled();
    expect(getBalance).not.toHaveBeenCalled();
    expect(updateBalance).not.toHaveBeenCalled();
    expect(acc.balance).toBe(7);
    expect(acc.sportBalance).toBeUndefined();
  });

  it("reads sport wallet on /sports even when the account still has an esport token", async () => {
    const { refreshAccountBalance } = await import("./balanceRefresh");
    vi.stubGlobal("location", { pathname: "/sports/football" });
    try {
      const acc = new PlatformAccount({
        accountId: 23,
        playerName: "ob-both",
        provider: "OB",
        token: "1234567890123456789",
        sportOb: { token: SPORT_HEX, venueMemberId: "1009139033518055424" },
      });
      acc.balance = 55;
      await refreshAccountBalance({} as never, acc);
      expect(fetchObSportAmountForAccount).toHaveBeenCalled();
      expect(getBalance).not.toHaveBeenCalled();
      expect(updateBalance).not.toHaveBeenCalled();
      expect(acc.sportBalance).toBe(9999882);
      expect(acc.balance).toBe(55);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("PM 余额拒绝后的补刷", () => {
  beforeEach(() => {
    updateBalance.mockClear(); fetchPolymarketBalanceViaTransport.mockReset();
    pmAccountShowsUnlockPending.mockReturnValue(false);
  });
  function rejectedAccount(withAmount = true) {
    const acc = new PlatformAccount({ accountId: 327, provider: "Polymarket", currency: "USDT", token: "same-token" });
    acc.balance = 50;
    const result = new BetResult("Polymarket", false, "balance rejected", undefined, {
      success: false, pmSubmitRejected: true,
      errorMsg: withAmount ? "the balance is not enough -> balance: 22300936, order amount: 27377400" : "insufficient balance",
    });
    return { acc, result };
  }
  it("补刷失败保留 PM 回执的余额，既不复活旧余额也不全账号禁投", async () => {
    const { acc, result } = rejectedAccount();
    applyPmBalanceRejection(acc, result);
    fetchPolymarketBalanceViaTransport.mockRejectedValue(new Error("network reset"));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    await refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    expect(acc.balance).toBe(22.300936); expect(acc.balanceStale).toBe(true);
    expect(acc.getBalance()).toBeLessThan(183); expect(acc.getBalance()).toBeGreaterThan(100);
    expect(updateBalance).not.toHaveBeenCalled();
  });
  it("没有明确数值且补刷失败时保持未知，下一次成功刷新后自然恢复", async () => {
    const { acc, result } = rejectedAccount(false); applyPmBalanceRejection(acc, result);
    fetchPolymarketBalanceViaTransport.mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ balance: 80, currency: "USDT" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    await refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    expect(acc.getBalance()).toBeUndefined();
    await refreshAccountBalance({} as never, acc);
    expect(acc.balance).toBe(80); expect(acc.balanceStale).toBe(false);
  });
  it.each([false, true])("拒单前查询迟到（失败=%s）不能覆盖新余额，并串行补查一次", async failed => {
    const { acc, result } = rejectedAccount();
    let finish!: (value: { balance: number; currency: string }) => void;
    let reject!: (reason: Error) => void;
    fetchPolymarketBalanceViaTransport.mockImplementationOnce(() => new Promise((resolve, rejectPromise) => {
      finish = resolve; reject = rejectPromise;
    })).mockRejectedValueOnce(new Error("next query unavailable"));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const old = refreshAccountBalance({} as never, acc);
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(1));
    applyPmBalanceRejection(acc, result);
    await refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(1);
    if (failed) reject(new Error("old query failed")); else finish({ balance: 50, currency: "USDT" });
    await old;
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(acc.loadingBalance).toBe(false));
    expect(acc.balance).toBe(22.300936); expect(updateBalance).not.toHaveBeenCalled();
  });
  it("查单占用 loadingBalance 时仍允许明确余额拒绝后的补刷", async () => {
    const { acc, result } = rejectedAccount(); applyPmBalanceRejection(acc, result); acc.loadingBalance = true;
    fetchPolymarketBalanceViaTransport.mockResolvedValue({ balance: 22.300936, currency: "USDT" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    await refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(1);
    expect(acc.balance).toBe(22.300936);
    expect(acc.loadingBalance).toBe(true);
  });
  it("查单在补刷期间先结束时，不复活已结束的加载标志", async () => {
    const { acc, result } = rejectedAccount(); applyPmBalanceRejection(acc, result); acc.loadingBalance = true;
    let finish!: (value: { balance: number; currency: string }) => void;
    fetchPolymarketBalanceViaTransport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const pending = refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledOnce());
    acc.loadingBalance = false;
    finish({ balance: 22.300936, currency: "USDT" }); await pending;
    expect(acc.loadingBalance).toBe(false);
  });
  it("PM 直接成交触发的新版本不会接受成交前发出的余额查询", async () => {
    const { acc } = rejectedAccount();
    let finish!: (value: { balance: number; currency: string }) => void;
    fetchPolymarketBalanceViaTransport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ balance: 22.300936, currency: "USDT" });
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const pending = refreshAccountBalance({} as never, acc);
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledOnce());
    invalidatePmBalanceQueries(acc);
    await refreshAccountBalance({} as never, acc);
    finish({ balance: 50, currency: "USDT" }); await pending;
    await vi.waitFor(() => expect(acc.balance).toBe(22.300936));
    expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(2);
    expect(updateBalance).toHaveBeenCalledExactlyOnceWith(327, 22.300936);
  });
  it.each(["token", "gateway", "accountId", "session"])("PM %s 改变后旧结果和自动补查均停止", async changed => {
    const { acc, result } = rejectedAccount();
    let finish!: (value: { balance: number; currency: string }) => void;
    fetchPolymarketBalanceViaTransport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const pending = refreshAccountBalance({} as never, acc);
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledOnce());
    applyPmBalanceRejection(acc, result);
    if (changed === "token") acc.token = "different";
    if (changed === "gateway") acc.gateway = "https://different.example";
    if (changed === "accountId") acc.accountId = 999;
    if (changed === "session") (await import("@/lib/authSession")).advanceAuthSessionVersion();
    finish({ balance: 50, currency: "USDT" }); await pending;
    expect(acc.balance).toBe(22.300936);
    expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledOnce();
    expect(updateBalance).not.toHaveBeenCalled();
  });
  it("旧回写响应不修改新余额对应的利润信息", async () => {
    const { acc, result } = rejectedAccount(); acc.totalProfit = 123;
    fetchPolymarketBalanceViaTransport.mockResolvedValueOnce({ balance: 50, currency: "USDT" })
      .mockRejectedValueOnce(new Error("follow-up unavailable"));
    let finish!: (value: { total: number; platformId: number; platformName: string }) => void;
    updateBalance.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { refreshAccountBalance } = await import("./balanceRefresh");
    const pending = refreshAccountBalance({} as never, acc);
    await vi.waitFor(() => expect(updateBalance).toHaveBeenCalledOnce());
    applyPmBalanceRejection(acc, result);
    finish({ total: 999, platformId: 1, platformName: "old" }); await pending;
    await vi.waitFor(() => expect(fetchPolymarketBalanceViaTransport).toHaveBeenCalledTimes(2));
    expect(acc.balance).toBe(22.300936); expect(acc.totalProfit).toBe(123);
  });
});

describe("非 PM 刷新行为保持原样", () => {
  it.each(["OB", "PredictFun"] as const)("%s 沿用原加载门控及成功刷新写入", async provider => {
    getBalance.mockReset(); updateBalance.mockClear();
    const acc = new PlatformAccount({ accountId: 9, provider, token: "old" }); acc.balance = 30; acc.loadingBalance = true;
    const { refreshAccountBalance } = await import("./balanceRefresh");
    await refreshAccountBalance({} as never, acc, { afterPmBalanceRejection: true });
    expect(getBalance).not.toHaveBeenCalled(); expect(acc.loadingBalance).toBe(true);
    acc.loadingBalance = false;
    let finish!: (value: { balance: number; currency: string }) => void;
    getBalance.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = refreshAccountBalance({} as never, acc);
    await vi.waitFor(() => expect(getBalance).toHaveBeenCalledOnce());
    acc.token = "new";
    finish({ balance: 66, currency: provider === "PredictFun" ? "USDT" : "CNY" }); await pending;
    expect(acc.balance).toBe(66); expect(acc.loadingBalance).toBe(false);
    expect(updateBalance).toHaveBeenCalledTimes(provider === "PredictFun" ? 0 : 1);
  });
});
