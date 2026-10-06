import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { applyUnsettledStats, syncVenueOrders } from "@/stores/account/venueOrders";

const saveOrders = vi.hoisted(() => vi.fn(async () => undefined));
const getOrders = vi.hoisted(() => vi.fn(async () => [] as VenueOrder[]));
const footballLoad = vi.hoisted(() => vi.fn(async () => undefined));
const footballAccountSync = vi.hoisted(() => vi.fn(async () => undefined));
const footballSync = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/api/order", () => ({
  saveOrders,
}));

vi.mock("@/runtime/providers", () => ({
  getProvider: () => ({ getOrders }),
}));

vi.mock("@/stores/footballOrderStore", () => ({
  useFootballOrderStore: () => ({
    loaded: true,
    loading: false,
    load: footballLoad,
    syncVenueAccountOrders: footballAccountSync,
    syncVenueSettlement: footballSync,
  }),
}));

function makeVenueOrder(
  partial: Pick<VenueOrder, "orderId" | "status" | "odds" | "betMoney">,
): VenueOrder {
  return {
    provider: "RAY",
    createAt: 0,
    reward: 0,
    money: 0,
    game: "",
    match: "",
    bet: "",
    item: "",
    ...partial,
  };
}

function makeAccount(balance?: number) {
  const acc = new PlatformAccount({
    accountId: 1,
    playerName: "test",
    provider: "RAY",
  });
  acc.balance = balance;
  return acc;
}

describe("applyUnsettledStats", () => {
  it("counts unsettled orders and adds exposure to winBalance", () => {
    const acc = makeAccount(500);
    const orders: VenueOrder[] = [
      makeVenueOrder({ orderId: "1", status: "none", odds: 2, betMoney: 100 }),
      makeVenueOrder({ orderId: "2", status: "none", odds: 1.5, betMoney: 200 }),
      makeVenueOrder({ orderId: "3", status: "win", odds: 2, betMoney: 50 }),
    ];
    applyUnsettledStats(acc, orders);
    expect(acc.unsettle).toBe(2);
    expect(acc.winBalance).toBe(500 + 2 * 100 + 1.5 * 200);
  });

  it("treats missing balance as zero for winBalance", () => {
    const acc = makeAccount(undefined);
    applyUnsettledStats(acc, [
      makeVenueOrder({ orderId: "1", status: "none", odds: 2, betMoney: 50 }),
    ]);
    expect(acc.unsettle).toBe(1);
    expect(acc.winBalance).toBe(100);
  });

  it("clears unsettle stats when venue returns no open orders", () => {
    const acc = makeAccount(500);
    acc.unsettle = 3;
    acc.winBalance = 999;
    applyUnsettledStats(acc, []);
    expect(acc.unsettle).toBe(0);
    expect(acc.winBalance).toBe(500);
  });

  it("excludes PF sold buys and sell rows from unsettle", () => {
    const acc = makeAccount(500);
    applyUnsettledStats(acc, [
      {
        ...makeVenueOrder({ orderId: "b1", status: "none", odds: 2, betMoney: 100 }),
        provider: "PredictFun",
        pfSide: "buy",
        pfSellState: "closed",
      },
      {
        ...makeVenueOrder({ orderId: "s1", status: "none", odds: 1.8, betMoney: 115 }),
        provider: "PredictFun",
        pfSide: "sell",
        pfBuyOrderId: "b1",
        pfSellState: "closed",
      },
      {
        ...makeVenueOrder({ orderId: "b2", status: "none", odds: 2, betMoney: 50 }),
        provider: "PredictFun",
        pfSide: "buy",
        pfSellState: "open",
        // 回款敞口 = 截断持仓×汇率；约等于旧 odds×betMoney=100
        pfHoldShares: 100 / 6.7,
        pfBookPrice: 0.5,
      },
    ]);
    expect(acc.unsettle).toBe(1);
    // 截断后持仓×汇率：trunc(100/6.7,2)*6.7
    expect(acc.winBalance).toBeCloseTo(500 + Math.trunc((100 / 6.7) * 100 + 1e-9) / 100 * 6.7, 8);
  });
});

describe("syncVenueOrders PredictFun", () => {
  beforeEach(() => {
    saveOrders.mockClear();
    getOrders.mockReset();
    getOrders.mockResolvedValue([
      {
        ...makeVenueOrder({ orderId: "pf1", status: "none", odds: 2, betMoney: 10 }),
        provider: "PredictFun",
        pfSide: "buy",
        pfHoldShares: 20,
        pfSellState: "open",
      },
    ]);
  });

  it("updates local stats but does not Client_SaveOrder", async () => {
    const acc = new PlatformAccount({
      accountId: 42,
      playerName: "pf-user",
      provider: "PredictFun",
    });
    acc.balance = 100;

    const orders = await syncVenueOrders(acc);
    expect(orders?.length).toBe(1);
    expect(acc.unsettle).toBe(1);
    expect(saveOrders).not.toHaveBeenCalled();
  });
});

describe("syncVenueOrders sports workspace", () => {
  const originalLocation = globalThis.location;

  beforeEach(() => {
    saveOrders.mockClear();
    getOrders.mockReset();
    footballLoad.mockClear();
    footballSync.mockClear();
    Object.defineProperty(globalThis, "location", {
      value: { pathname: "/sports/football" },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: originalLocation,
      configurable: true,
    });
  });

  it("routes OB sport accounts through football settlement instead of esport getOrders", async () => {
    const acc = new PlatformAccount({
      accountId: 171,
      playerName: "olago15",
      provider: "OB",
      sportOb: {
        token: "abcdef0123456789abcdef0123456789abcdef01",
        gateway: "https://api.example.com",
        venueMemberId: "1009328104483790848",
      },
    });

    const orders = await syncVenueOrders(acc);
    expect(orders).toEqual([]);
    expect(footballAccountSync).toHaveBeenCalledWith(171);
    expect(footballSync).toHaveBeenCalledTimes(1);
    expect(getOrders).not.toHaveBeenCalled();
    expect(saveOrders).not.toHaveBeenCalled();
  });
});

describe("syncVenueOrders OB sport-only cards in esport workspace", () => {
  const originalLocation = globalThis.location;
  beforeEach(() => {
    vi.clearAllMocks();
    getOrders.mockResolvedValue([]);
    Object.defineProperty(globalThis, "location", { value: { pathname: "/" }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true });
  });

  function sportAccount(token?: string) {
    return new PlatformAccount({
      accountId: 171,
      playerName: "sport-user",
      provider: "OB",
      gateway: "https://clob.polymarket.com",
      token,
      sportOb: { token: "abcdef0123456789abcdef01", gateway: "https://api.example.com", venueMemberId: "1009328104483790848" },
    });
  }

  it("does not request or save esport orders for a sport-only card with a stale gateway", async () => {
    expect(await syncVenueOrders(sportAccount())).toBeUndefined();
    expect(getOrders).not.toHaveBeenCalled();
    expect(saveOrders).not.toHaveBeenCalled();
    expect(footballAccountSync).not.toHaveBeenCalled();
  });

  it("does not use a legacy sport token for esport orders", async () => {
    const account = sportAccount("abcdef0123456789abcdef01");
    account.sportOb = undefined;
    expect(await syncVenueOrders(account)).toBeUndefined();
    expect(getOrders).not.toHaveBeenCalled();
    expect(saveOrders).not.toHaveBeenCalled();
  });

  it("does not request esport orders without a token even when sport credentials are absent", async () => {
    const account = sportAccount();
    account.sportOb = undefined;
    expect(await syncVenueOrders(account)).toBeUndefined();
    expect(getOrders).not.toHaveBeenCalled();
  });

  it("keeps esport order refresh for an OB card with both credentials", async () => {
    const account = sportAccount("12345678901234567890");
    account.gateway = "https://ob.example.com";
    expect(await syncVenueOrders(account)).toEqual([]);
    expect(getOrders).toHaveBeenCalledWith(account);
    expect(saveOrders).toHaveBeenCalledTimes(1);
    expect(footballAccountSync).not.toHaveBeenCalled();
  });
});

describe("syncVenueOrders waitForOrderId", () => {
  beforeEach(() => {
    saveOrders.mockClear();
    getOrders.mockReset();
  });

  it("retries getOrders until orderId appears then saves once", async () => {
    getOrders
      .mockResolvedValueOnce([
        makeVenueOrder({ orderId: "old", status: "none", odds: 2, betMoney: 10 }),
      ])
      .mockResolvedValueOnce([
        makeVenueOrder({ orderId: "old", status: "none", odds: 2, betMoney: 10 }),
        makeVenueOrder({ orderId: "0xnew", status: "none", odds: 1.8, betMoney: 20 }),
      ]);

    const acc = makeAccount(100);
    acc.provider = "Polymarket";
    const orders = await syncVenueOrders(acc, {
      waitForOrderId: "0xnew",
      waitForOrderGapMs: 1,
    });

    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(orders?.some(o => o.orderId === "0xnew")).toBe(true);
    expect(saveOrders).toHaveBeenCalledTimes(1);
  });

  it("saves last result after exhausting attempts", async () => {
    getOrders.mockResolvedValue([
      makeVenueOrder({ orderId: "old", status: "none", odds: 2, betMoney: 10 }),
    ]);
    const acc = makeAccount(100);
    await syncVenueOrders(acc, {
      waitForOrderId: "0xmissing",
      waitForOrderAttempts: 3,
      waitForOrderGapMs: 1,
    });
    expect(getOrders).toHaveBeenCalledTimes(3);
    expect(saveOrders).toHaveBeenCalledTimes(1);
  });

  it("retries RAY-style lookup until a recent order appears", async () => {
    getOrders
      .mockResolvedValueOnce([
        { ...makeVenueOrder({ orderId: "old", status: "none", odds: 2, betMoney: 10 }), createAt: 1_000 },
      ])
      .mockResolvedValueOnce([
        { ...makeVenueOrder({ orderId: "ray-new", status: "none", odds: 1.8, betMoney: 20 }), createAt: 50_000 },
      ]);

    const acc = makeAccount(100);
    acc.provider = "RAY";
    const orders = await syncVenueOrders(acc, {
      waitForRecentOrderAfterMs: 50_000,
      waitForOrderGapMs: 1,
    });

    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(orders?.[0]?.orderId).toBe("ray-new");
    expect(saveOrders).toHaveBeenCalledTimes(1);
  });
});
