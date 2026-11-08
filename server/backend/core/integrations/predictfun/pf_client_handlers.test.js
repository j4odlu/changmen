import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../account/player_ownership.js", () => ({
  assertPlayerOwnedByUser: vi.fn(async (playerId, userId) => {
    if (!userId)
      return { ok: false, msg: "请先登录" };
    if (Number(playerId) !== 42)
      return { ok: false, msg: "不属于当前用户" };
    return {
      ok: true,
      player: {
        id: 42,
        ownerUserId: String(userId),
        provider: "PredictFun",
        platformName: "PredictFun",
        credit: 0,
        totalBalance: 1000,
      },
    };
  }),
  isPredictFunPlayerRow: (player) => {
    const provider = String(player?.provider ?? "").trim().toLowerCase();
    if (provider === "predictfun")
      return true;
    const name = String(player?.platformName ?? "").trim().toLowerCase();
    return name === "predictfun" || name.includes("predict.fun") || name.includes("predictfun");
  },
}));

vi.mock("../../account/account_store.js", () => ({
  updatePlayerBalance: vi.fn(async (_id, bal) => ({ total: bal })),
  debitPlayerBalance: vi.fn(async (_id, amount) => ({ total: 1000 - Number(amount) })),
  creditPlayerBalance: vi.fn(async (_id, amount) => ({ total: 1000 + Number(amount) })),
  claimCreditPfPendingOrder: vi.fn(async (playerId, orderId, userId) => {
    const orderStore = await import("../../account/order_store.js");
    const sb = await import("@changmen/db");
    let amount = 0;
    const saves = orderStore.saveOrder.mock.calls;
    for (let i = saves.length - 1; i >= 0; i -= 1) {
      const batch = saves[i][1];
      if (!Array.isArray(batch))
        continue;
      for (const o of batch) {
        if (String(o.orderId) === String(orderId) && o.pfLedgerState === "pending_credit") {
          amount = Number(o.pfPendingCreditUsdt) || 0;
          break;
        }
      }
      if (amount > 0)
        break;
    }
    if (!(amount > 0)) {
      const rows = await sb.fetchOrdersByPlayer(playerId, userId);
      const hit = (rows || []).find(r => String(r.order_id) === String(orderId));
      amount = Number(hit?.raw?.pfPendingCreditUsdt) || 0;
    }
    const total = 1000 + amount;
    await orderStore.saveOrder(playerId, [{
      orderId,
      provider: "PredictFun",
      odds: 0,
      betMoney: 0,
      money: 0,
      status: "none",
      createAt: Date.now(),
      pfLedgerState: "credited",
      pfPendingCreditUsdt: 0,
    }], userId, "PredictFun");
    return { ok: true, amount, total };
  }),
  adjustPfSellProceedsAfterFee: vi.fn(async () => ({
    ok: true,
    mode: "credit_delta",
    amount: 0,
    delta: 0,
    total: 1000,
  })),
  getAccountsFromKv: vi.fn(() => []),
}));

vi.mock("../../account/order_store.js", () => ({
  listByPlayer: vi.fn(async () => []),
  saveOrder: vi.fn(async () => true),
  rowToOrder: (r) => ({
    OrderID: r.order_id,
    Status: r.status || "None",
    BetMoney: r.bet_money || 0,
    Money: r.money || 0,
    Odds: r.odds || 0,
    CreateAt: r.create_at || 0,
    Match: r.match || "",
    Item: r.item || "",
    Link: r.link || 0,
  }),
  resolvePfHoldSharesFromRaw: (raw) => {
    const stored = Number(raw?.pfHoldShares);
    if (stored > 0)
      return stored;
    const shares = Number(raw?.pfShares);
    if (!(shares > 0))
      return undefined;
    const type = String(raw?.pfFeeType || "").toUpperCase();
    const wei = String(raw?.pfFeeAmountWei || "").trim();
    if (type === "SHARES" && /^\d+$/.test(wei)) {
      try {
        const fee = Number(BigInt(wei)) / 1e18;
        const net = shares - fee;
        if (Number.isFinite(net) && net > 0)
          return net;
      }
      catch {
        /* ignore */
      }
    }
    return shares;
  },
}));

vi.mock("@changmen/db", () => {
  const fetchOrdersByPlayer = vi.fn(async () => []);
  const fetchPlayersByIds = vi.fn(async (ids) => (ids || []).map(id => ({
    id: Number(id),
    playerId: Number(id),
    venueMemberId: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
    accountData: {
      token: JSON.stringify({
        predictAccount: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
      }),
    },
  })));
  return {
    fetchOrdersByPlayer,
    fetchOrdersByPlayerStrict: (...args) => fetchOrdersByPlayer(...args),
    fetchPlayersByIds,
  };
});

vi.mock("../../esport-api/store.js", () => ({
  default: {
    getAccountsForUser: vi.fn(() => [{ accountId: 42, credit: 0, balance: 1000, provider: "PredictFun" }]),
    setAccountsForUser: vi.fn(async () => {}),
  },
}));

vi.mock("./house_credentials.js", () => ({
  isPredictFunHouseConfigured: () => true,
  resolvePfHouseMaxStakeUsdt: () => 500,
  resolvePfChangmenFeeRateBps: vi.fn(() => 0),
  resolvePfChangmenBuyFeeRateBps: vi.fn(() => 0),
  resolvePfChangmenSellFeeRateBps: vi.fn(() => 0),
}));

vi.mock("./pf_api.js", () => ({
  fetchPredictMarket: vi.fn(async () => ({
    feeRateBps: 0,
    isNegRisk: false,
    isYieldBearing: false,
    status: "REGISTERED",
    tradingStatus: "OPEN",
  })),
  predictFunPost: vi.fn(async () => ({
    success: true,
    data: { orderId: "ord-1", code: "accepted" },
  })),
}));

vi.mock("./pf_server_order.js", () => ({
  upsertPfServerOrder: vi.fn(async (playerId, orders, userId) => {
    const orderStore = await import("../../account/order_store.js");
    return orderStore.saveOrder(playerId, orders, userId, "PredictFun");
  }),
}));

vi.mock("./pf_house_redeem.js", () => ({
  tryRedeemHouseMarketAfterSettle: vi.fn(async () => {}),
  redeemHouseResolvedPositions: vi.fn(async () => ({ ok: true, redeemed: 0, failed: 0 })),
}));

vi.mock("./pf_order_service.js", () => ({
  isValidPredictClobPrice: (v) => Number.isFinite(v) && v > 0 && v < 1,
  REUSE_BOOK_MAX_AGE_MS: 800,
  prepareHouseSigner: vi.fn(async () => ({
    Side: {},
    orderBuilder: {},
    maker: "0xabc",
    jwt: "jwt",
  })),
  resolveExecutableBuy: vi.fn(async () => ({
    bookPrice: 0.4,
    bookOdds: 2.5,
    bookFetchedAt: Date.now(),
    feeRateBps: 200,
    isNegRisk: false,
    isYieldBearing: false,
    yesBook: { asks: [], bids: [] },
    market: {},
  })),
  createAndSubmitHouseMarketBuy: vi.fn(async () => ({
    requestBody: { data: { order: { hash: "0xhash1" } } },
    result: { success: true, data: { orderId: "ord-1", code: "ok" } },
    bookPrice: 0.4,
    bookOdds: 2.5,
    signerAddress: "0xabc",
    sharesWei: "25000000000000000000",
    shares: 25,
    makerUsdt: 10,
  })),
  createAndSubmitHouseMarketSell: vi.fn(async () => ({
    requestBody: { data: { order: { hash: "0xsell1" } } },
    result: { success: true, data: { orderId: "sell-1" } },
    bookPrice: 0.55,
    bookOdds: 1.818,
    sharesWei: "25000000000000000000",
    shares: 25,
    proceedsUsdt: 13.75,
  })),
  estimateHouseMarketBuyMakerUsdt: vi.fn(async () => ({
    makerUsdt: 10,
    shares: 25,
    sharesWei: "25000000000000000000",
    bookPrice: 0.4,
    bookOdds: 2.5,
  })),
  estimatePfSharesWei: () => 25000000000000000000n,
  weiToDecimal18: (w) => Number(BigInt(String(w))) / 1e18,
  decimal18ToWei: (n) => BigInt(Math.round(Number(n) * 1e18)),
  isPredictFunOrderAccepted: (r) => Boolean(r?.success && r?.data?.orderId),
  withHouseOrderLock: async (fn) => fn(),
}));

vi.mock("./pf_orders.js", () => ({
  fetchHousePredictOrderByHash: vi.fn(),
  fetchHousePredictOrderResolved: vi.fn(),
  fetchPredictOrderByHash: vi.fn(),
  waitForPredictOrderTerminal: vi.fn(async () => ({
    status: "FILLED",
    amount: "13.75",
    amountFilled: "25000000000000000000",
    order: {
      hash: "0xsell1",
      makerAmount: "25000000000000000000",
      takerAmount: "13750000000000000000",
      side: 1,
    },
  })),
  hasWalletFeeSignal: (official) => {
    const fee = official?.pfWalletFee ?? official?.fee;
    const wei = String(fee?.amountWei ?? fee?.amount ?? "").trim();
    return /^\d+$/.test(wei) && BigInt(wei) > 0n;
  },
  waitForHouseOrderTerminal: vi.fn(async () => ({
    status: "FILLED",
    amount: "13.75",
    amountFilled: "25000000000000000000",
    order: {
      hash: "0xsell1",
      makerAmount: "25000000000000000000",
      takerAmount: "13750000000000000000",
      side: 1,
    },
  })),
  awaitHouseOrderFee: vi.fn(async (official) => official),
  isOpenChangmenOrderStatus: (s) => {
    const v = String(s ?? "").toLowerCase();
    return v === "none" || v === "pending" || v === "";
  },
  mapPredictOrderToVenueOrder: (official, rds = {}) => ({
    provider: "PredictFun",
    orderId: String(rds.orderId || official?.order?.hash || ""),
    status: official?.status === "CANCELLED" ? "reject" : official?.status === "FILLED" ? "none" : "pending",
    odds: Number(rds.odds) || 0,
    betMoney: Number(rds.betMoney) || 0,
    money: 0,
    createAt: Number(rds.createAt) || 1,
    reward: 0,
    game: "",
    match: "",
    bet: "PredictFun",
    item: "",
    pfHoldShares: rds.pfHoldShares,
    pfNotionalUsdt: rds.pfNotionalUsdt,
    pfFillCostUsdt: rds.pfFillCostUsdt ?? 9.8,
    pfFeeAmountWei: rds.pfFeeAmountWei ?? "1",
    pfFeeType: rds.pfFeeType ?? "SHARES",
    pfSide: rds.pfSide,
    pfSellState: rds.pfSellState,
  }),
  settlementFromPredictOfficialStatus: (s) => {
    const v = String(s ?? "").toUpperCase();
    if (v === "FILLED")
      return "filled";
    if (v === "CANCELLED" || v === "EXPIRED" || v === "INVALIDATED")
      return "unfilled";
    return "timeout";
  },
}));

import * as accountStore from "../../account/account_store.js";
import * as orderStore from "../../account/order_store.js";
import * as sb from "@changmen/db";
import { fetchHousePredictOrderByHash, fetchHousePredictOrderResolved } from "./pf_orders.js";
import { upsertPfServerOrder } from "./pf_server_order.js";
import {
  handlePfCheckBet,
  handlePfGetOrder,
  handlePfRefreshBalance,
  handlePfSubmitOrder,
  handlePfSubmitSell,
} from "./pf_client_handlers.js";

describe("pf_client_handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderStore.listByPlayer.mockResolvedValue([]);
    sb.fetchOrdersByPlayer.mockResolvedValue([]);
    fetchHousePredictOrderResolved.mockImplementation(async (id) => fetchHousePredictOrderByHash(id));
    upsertPfServerOrder.mockImplementation(async (playerId, orders, userId) => {
      return orderStore.saveOrder(playerId, orders, userId, "PredictFun");
    });
  });

  it("CheckBet prompts client upgrade; legacy SubmitOrder/Sell reject membership", async () => {
    const check = await handlePfCheckBet({ playerId: 42 }, "u1");
    expect(check.ok).toBe(false);
    expect(String(check.msg)).toMatch(/浏览器|升级/);

    const removed = /会员中转已下线|自有账号/;
    for (const fn of [handlePfSubmitOrder, handlePfSubmitSell]) {
      const r = await fn({
        playerId: 42,
        tokenId: "t",
        marketId: "1",
        apiBetMoney: 10,
        detectionMaxPrice: 0.5,
        buyOrderId: "0xbuy1",
      }, "u1");
      expect(r.ok).toBe(false);
      expect(String(r.msg)).toMatch(removed);
    }
  });

  it("SubmitOrder userSigned relays and persists without ledger debit", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");
    predictFunPost.mockResolvedValueOnce({
      success: true,
      data: { orderId: "ord-1", code: "accepted" },
    });
    upsertPfServerOrder.mockResolvedValue(true);

    const r = await handlePfSubmitOrder({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      createOrderBody: {
        data: {
          order: {
            hash: "0xhash1",
            maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
            signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          },
          strategy: "MARKET",
          isFillOrKill: true,
        },
      },
      marketId: "830202",
      tokenId: "tok",
      apiBetMoney: 5,
      bookPrice: 0.4,
      bookOdds: 2.5,
      makerUsdt: 5,
      orderHash: "0xhash1",
      feeRateBps: 0,
      match: "A vs B",
      bet: "全场胜负",
      item: "主队",
    }, "u1");

    expect(r.ok).toBe(true);
    expect(r.info.orderId).toBe("0xhash1");
    expect(predictFunPost).toHaveBeenCalledWith(
      "/v1/orders",
      expect.objectContaining({ data: expect.any(Object) }),
      "user.jwt",
    );
    expect(upsertPfServerOrder).toHaveBeenCalled();
    const pendingCall = upsertPfServerOrder.mock.calls[0];
    const row = pendingCall[1][0];
    expect(row.pfUserSigned).toBe(true);
    expect(row.status).toBe("Pending");
    expect(row.orderId).toBe("0xhash1");
    // Pending 必须先于官网 POST，避免受理后落库失败孤儿仓
    const pendingOrder = upsertPfServerOrder.mock.invocationCallOrder[0];
    const postOrder = predictFunPost.mock.invocationCallOrder[0];
    expect(pendingOrder).toBeLessThan(postOrder);
  });

  it("SubmitOrder aborts before POST when pending persist fails", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");
    upsertPfServerOrder.mockResolvedValueOnce(false);

    const r = await handlePfSubmitOrder({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      createOrderBody: {
        data: {
          order: {
            hash: "0xhash-abort",
            maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
            signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          },
          strategy: "MARKET",
          isFillOrKill: true,
        },
      },
      marketId: "830202",
      tokenId: "tok",
      apiBetMoney: 5,
      bookPrice: 0.4,
      bookOdds: 2.5,
      orderHash: "0xhash-abort",
    }, "u1");

    expect(r.ok).toBe(false);
    expect(String(r.msg)).toMatch(/落库失败.*未向官网提交/);
    expect(predictFunPost).not.toHaveBeenCalled();
  });

  it("SubmitOrder marks reject when upstream declines after pending persist", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");
    upsertPfServerOrder.mockResolvedValue(true);
    predictFunPost.mockResolvedValueOnce({
      success: false,
      data: { code: "INSUFFICIENT_BALANCE" },
    });

    const r = await handlePfSubmitOrder({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      createOrderBody: {
        data: {
          order: {
            hash: "0xhash-rej",
            maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
            signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          },
          strategy: "MARKET",
          isFillOrKill: true,
        },
      },
      marketId: "830202",
      tokenId: "tok",
      apiBetMoney: 5,
      bookPrice: 0.4,
      bookOdds: 2.5,
      orderHash: "0xhash-rej",
    }, "u1");

    expect(r.ok).toBe(false);
    expect(String(r.msg)).toMatch(/未受理/);
    const rejectRow = upsertPfServerOrder.mock.calls
      .map((c) => c[1]?.[0])
      .find((o) => o?.status === "reject");
    expect(rejectRow?.orderId).toBe("0xhash-rej");
  });

  it("SubmitOrder accepts form-urlencoded JSON-string createOrderBody", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");
    predictFunPost.mockResolvedValueOnce({
      success: true,
      data: { orderId: "ord-str", code: "accepted" },
    });
    upsertPfServerOrder.mockResolvedValueOnce(true);

    const createOrderBody = {
      data: {
        order: {
          hash: "0xhash-str",
          maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
        },
        strategy: "MARKET",
        isFillOrKill: true,
      },
    };

    const r = await handlePfSubmitOrder({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      // 对齐客户端 toEsportPostBody：嵌套对象被 stringify
      createOrderBody: JSON.stringify(createOrderBody),
      marketId: "830202",
      tokenId: "tok",
      apiBetMoney: 5,
      bookPrice: 0.4,
      bookOdds: 2.5,
      makerUsdt: 5,
      orderHash: "0xhash-str",
    }, "u1");

    expect(r.ok).toBe(true);
    expect(r.info.orderId).toBe("0xhash-str");
    expect(predictFunPost).toHaveBeenCalledWith(
      "/v1/orders",
      createOrderBody,
      "user.jwt",
    );
  });

  it("SubmitSell userSigned relays, closes buy, skips ledger credit", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");
    const { waitForPredictOrderTerminal } = await import("./pf_orders.js");

    sb.fetchOrdersByPlayer.mockResolvedValue([{
      order_id: "0xbuy1",
      status: "None",
      bet_money: 10,
      money: 0,
      odds: 2.5,
      create_at: 1,
      match: "A vs B",
      item: "主队",
      link: 0,
      raw: {
        pfOrderHash: "0xbuy1",
        pfMarketId: "830202",
        pfTokenId: "tok",
        pfHoldShares: 25,
        pfSide: "buy",
        pfSellState: "open",
        pfUserSigned: true,
        pfNotionalUsdt: 10,
      },
    }]);
    predictFunPost.mockResolvedValueOnce({
      success: true,
      data: { orderId: "sell-api-1", code: "accepted" },
    });
    waitForPredictOrderTerminal.mockResolvedValueOnce({
      status: "FILLED",
      amount: "13.75",
      amountFilled: "25000000000000000000",
      order: {
        hash: "0xsell1",
        makerAmount: "25000000000000000000",
        takerAmount: "13750000000000000000",
        side: 1,
      },
    });

    const r = await handlePfSubmitSell({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      buyOrderId: "0xbuy1",
      orderHash: "0xsell1",
      createOrderBody: {
        data: {
          order: {
            hash: "0xsell1",
            maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
            signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          },
          strategy: "MARKET",
          isFillOrKill: true,
        },
      },
      bookPrice: 0.55,
      bookOdds: 1.818,
      proceedsUsdt: 13.75,
    }, "u1");

    expect(r.ok).toBe(true);
    expect(r.info.sellOrderId).toBe("0xsell1");
    expect(r.info.proceedsUsdt).toBe(13.75);
    expect(predictFunPost).toHaveBeenCalledWith(
      "/v1/orders",
      expect.objectContaining({ data: expect.any(Object) }),
      "user.jwt",
    );
    expect(accountStore.creditPlayerBalance).not.toHaveBeenCalled();
    expect(accountStore.claimCreditPfPendingOrder).not.toHaveBeenCalled();
    const closingCallIdx = upsertPfServerOrder.mock.calls.findIndex(
      (c) => Array.isArray(c[1]) && c[1].some((o) => o.pfSellState === "closing"),
    );
    expect(closingCallIdx).toBeGreaterThanOrEqual(0);
    const closingInvocation = upsertPfServerOrder.mock.invocationCallOrder[closingCallIdx];
    const postInvocation = predictFunPost.mock.invocationCallOrder[0];
    expect(closingInvocation).toBeLessThan(postInvocation);
    const closedBatch = upsertPfServerOrder.mock.calls.find(
      (c) => Array.isArray(c[1]) && c[1].some((o) => o.pfSellState === "closed"),
    );
    expect(closedBatch).toBeTruthy();
    const buyClosed = closedBatch[1].find((o) => o.pfSide === "buy");
    expect(buyClosed.pfUserSigned).toBe(true);
    expect(buyClosed.pfLedgerState).toBe("credited");
    expect(buyClosed.money).toBe(3.75);
  });

  it("SubmitSell aborts before POST when closing persist fails", async () => {
    const { predictFunPost } = await import("./pf_api.js");
    const { upsertPfServerOrder } = await import("./pf_server_order.js");

    sb.fetchOrdersByPlayer.mockResolvedValue([{
      order_id: "0xbuy-abort",
      status: "None",
      bet_money: 10,
      money: 0,
      odds: 2.5,
      create_at: 1,
      match: "A vs B",
      item: "主队",
      link: 0,
      raw: {
        pfOrderHash: "0xbuy-abort",
        pfMarketId: "830202",
        pfTokenId: "tok",
        pfHoldShares: 25,
        pfSide: "buy",
        pfSellState: "open",
        pfUserSigned: true,
        pfNotionalUsdt: 10,
      },
    }]);
    upsertPfServerOrder.mockResolvedValueOnce(false);

    const r = await handlePfSubmitSell({
      playerId: 42,
      mode: "userSigned",
      jwt: "user.jwt",
      buyOrderId: "0xbuy-abort",
      orderHash: "0xsell-abort",
      createOrderBody: {
        data: {
          order: {
            hash: "0xsell-abort",
            maker: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
            signer: "0xC22eAe5aF78A221b8A27f217C8f37C08D530eE62",
          },
          strategy: "MARKET",
          isFillOrKill: true,
        },
      },
    }, "u1");

    expect(r.ok).toBe(false);
    expect(String(r.msg)).toMatch(/closing.*未向官网提交|落库失败/);
    expect(predictFunPost).not.toHaveBeenCalled();
  });

  it("getOrder rejects unknown orderId without house lookup", async () => {
    sb.fetchOrdersByPlayer.mockResolvedValue([]);
    fetchHousePredictOrderResolved.mockClear();
    const r = await handlePfGetOrder({ playerId: 42, orderId: "0xforeign" }, "u1");
    expect(r.ok).toBe(false);
    expect(String(r.msg)).toMatch(/不存在|不属于/);
    expect(fetchHousePredictOrderResolved).not.toHaveBeenCalled();
  });

  it("getOrder refunds on CANCELLED", async () => {
    sb.fetchOrdersByPlayer.mockResolvedValue([{
      order_id: "0xhash1",
      status: "Pending",
      bet_money: 10,
      money: 0,
      odds: 2.5,
      create_at: 1,
      match: "830202",
      item: "t",
      link: 0,
      raw: { pfOrderHash: "0xhash1", pfApiOrderId: "ord-1" },
    }]);
    fetchHousePredictOrderByHash.mockResolvedValue({
      id: "ord-1",
      status: "CANCELLED",
      marketId: 830202,
      order: { hash: "0xhash1", tokenId: "t" },
      amountFilled: "0",
    });
    const r = await handlePfGetOrder({ playerId: 42, orderId: "0xhash1" }, "u1");
    expect(r.ok).toBe(true);
    expect(r.info.settlement).toBe("unfilled");
    expect(r.info.refunded).toBe(true);
    expect(r.info.official).toBeUndefined();
    expect(r.info.officialStatus).toBeUndefined();
    expect(accountStore.claimCreditPfPendingOrder).toHaveBeenCalled();
  });

  it("getOrder FILLED keeps user stake betMoney; records pfFillCostUsdt when known", async () => {
    sb.fetchOrdersByPlayer.mockResolvedValue([{
      order_id: "0xhash1",
      status: "Pending",
      bet_money: 10,
      money: 0,
      odds: 2.5,
      create_at: 1,
      match: "830202",
      item: "t",
      link: 0,
      raw: {
        pfOrderHash: "0xhash1",
        pfApiOrderId: "ord-1",
        pfSide: "buy",
        pfNotionalUsdt: 10,
      },
    }]);
    fetchHousePredictOrderByHash.mockResolvedValue({
      id: "ord-1",
      status: "FILLED",
      marketId: 830202,
      amount: "9.8",
      amountFilled: "25000000000000000000",
      order: {
        hash: "0xhash1",
        tokenId: "t",
        side: 0,
        makerAmount: "10000000000000000000",
        takerAmount: "25000000000000000000",
      },
    });
    accountStore.updatePlayerBalance.mockClear();
    const r = await handlePfGetOrder({ playerId: 42, orderId: "0xhash1" }, "u1");
    expect(r.ok).toBe(true);
    expect(r.info.settlement).toBe("filled");
    expect(r.info.official).toBeUndefined();
    expect(r.info.order?.pfFillCostUsdt).toBeUndefined();
    expect(r.info.order?.pfFeeAmountWei).toBeUndefined();
    expect(orderStore.saveOrder).toHaveBeenCalled();
    const saved = orderStore.saveOrder.mock.calls[0][1][0];
    expect(saved.betMoney).toBe(10);
    expect(saved.pfNotionalUsdt).toBe(10);
    expect(saved.pfFillCostUsdt).toBe(9.8);
    expect(saved.pfShares).toBe(25);
    expect(accountStore.updatePlayerBalance).not.toHaveBeenCalled();
  });

  it("GetOrder keeps settlement=timeout when FILLED but buy fee not ready", async () => {
    sb.fetchOrdersByPlayer.mockResolvedValue([{
      order_id: "0xhash-fee",
      status: "Pending",
      bet_money: 10,
      money: 0,
      odds: 2.5,
      create_at: 1,
      match: "830202",
      item: "t",
      link: 0,
      raw: {
        pfOrderHash: "0xhash-fee",
        pfApiOrderId: "ord-fee",
        pfSide: "buy",
        pfNotionalUsdt: 10,
        pfFeeRateBps: 30,
      },
    }]);
    fetchHousePredictOrderByHash.mockResolvedValue({
      id: "ord-fee",
      status: "FILLED",
      marketId: 830202,
      amount: "9.8",
      amountFilled: "25000000000000000000",
      order: {
        hash: "0xhash-fee",
        tokenId: "t",
        side: 0,
        makerAmount: "10000000000000000000",
        takerAmount: "25000000000000000000",
      },
    });
    const r = await handlePfGetOrder({ playerId: 42, orderId: "0xhash-fee" }, "u1");
    expect(r.ok).toBe(true);
    expect(r.info.settlement).toBe("timeout");
    expect(r.info.order?.status).toBe("pending");
    const saved = orderStore.saveOrder.mock.calls.at(-1)[1][0];
    expect(saved.status).toBe("pending");
    expect(saved.pfOfficialStatus).toBe("FILLED");
  });

  it("refreshBalance returns total_balance", async () => {
    const r = await handlePfRefreshBalance({ playerId: 42 }, "u1");
    expect(r.ok).toBe(true);
    expect(r.info.balance).toBe(1000);
    expect(r.info.accountId).toBe(42);
    expect(r.info.currency).toBe("USDT");
    expect(r.info.credit).toBeUndefined();
    expect(r.info.token).toBeUndefined();
    expect(r.info.game).toBeUndefined();
    expect(r.info.pause).toBeUndefined();
    expect(r.info.platformName).toBeUndefined();
    expect(r.info.rateConfig).toBeUndefined();
  });
});
