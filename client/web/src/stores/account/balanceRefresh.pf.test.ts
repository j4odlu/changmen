import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";

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

vi.mock("@changmen/venue-adapter/polymarket", () => ({
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
