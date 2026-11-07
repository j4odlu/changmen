import { describe, expect, it } from "vitest";
import type { AdminAccountDetail, AdminOrderRow } from "@/types/admin";
import {
  adminOrderToOrderRow,
  adminPlayerLabel,
  countAdminPrimaryOrders,
  filterAdminOrdersBelongingToDate,
  groupAdminOrderEntries,
  mergeAdminAccountsWithOrderHistory,
} from "./adminOrderDisplay";
import { toOrderDateKeyLocal } from "./orderLink";
import {
  pmBuyLifecycleTagText,
  pmOrderStakeDisplayCny,
  resolvePmOrderListStatusClass,
} from "./pmOrderDisplay";

function order(patch: Partial<AdminOrderRow>): AdminOrderRow {
  return {
    id: 1,
    userId: "u1",
    playerId: 101,
    orderId: "o1",
    linkId: 1_700_000_000_000,
    provider: "OB",
    match: "A vs B",
    bet: "全场",
    item: "主",
    odds: 1.9,
    betMoney: 100,
    money: 0,
    status: "None",
    createAt: 1_700_000_000_000,
    ...patch,
  };
}

function account(patch: Partial<AdminAccountDetail>): AdminAccountDetail {
  return {
    accountId: 101,
    platform: "PB",
    platformId: 0,
    platformName: "平博",
    playerName: "tester",
    balance: 0,
    credit: 0,
    currency: "CNY",
    winBalance: 0,
    unsettle: 0,
    proxyId: 0,
    pause: false,
    markupOnly: false,
    noMarkup: false,
    active: false,
    minOdds: 0,
    maxOdds: 0,
    minDefault: 0,
    maxDefault: 0,
    profit: 0,
    maxProfit: 0,
    maxBetCount: 0,
    maxOrder: 0,
    todayOrder: 0,
    today: 0,
    orderCount: 0,
    totalProfit: 0,
    maxBalance: 0,
    maxWinBalance: 0,
    description: "",
    realName: "",
    mobile: "",
    city: "",
    multiply: 1,
    maxBalanceOdds: 2,
    lastOdds: false,
    workTimes: [],
    rateConfig: [],
    game: {},
    gatewayHost: "",
    hasCredentials: false,
    updateTime: 0,
    ...patch,
  };
}

describe("adminOrderDisplay", () => {
  it("uses the betting account platform for the provider icon", () => {
    expect(adminOrderToOrderRow(order({ provider: "OB" }), [account({ platform: "PB" })]).Type)
      .toBe("PB");

    const grouped = groupAdminOrderEntries(
      [order({ orderId: "hg-1", playerId: 202, provider: "OB" })],
      [account({ accountId: 202, platform: "HG" })],
    );

    expect(grouped[0]?.orderRows[0]?.Type).toBe("HG");
  });

  it("falls back to the stored order provider when the account is unavailable", () => {
    expect(adminOrderToOrderRow(order({ provider: "OB" }), []).Type).toBe("OB");
  });

  it("keeps Type=Polymarket even when account platform differs so PM list template applies", () => {
    expect(adminOrderToOrderRow(
      order({
        provider: "Polymarket",
        playerId: 101,
        betMoney: 0,
        money: 0,
        status: "None",
        pmSide: "buy",
        pmSellState: "closed",
        pmStakeUsdc: 0,
        pmShares: 10,
        pmAttributedSellShares: 10,
        pmFillPrice: 0.5,
      }),
      [account({ accountId: 101, platform: "OB", platformName: "误配" })],
    ).Type).toBe("Polymarket");
  });

  it("maps PM fields for workbench-parity OrderList display", () => {
    const row = adminOrderToOrderRow(order({
      provider: "Polymarket",
      betMoney: 0,
      money: 0,
      status: "None",
      pmSide: "buy",
      pmSellState: "closed",
      pmStakeUsdc: 0,
      pmShares: 57.66,
      pmAttributedSellShares: 57.66,
      pmFillPrice: 0.5,
      pmOrigin: "changmen",
    }));
    expect(row.PmSellState).toBe("closed");
    expect(row.PmSide).toBe("buy");
    expect(row.PmShares).toBe(57.66);
    expect(row.PmAttributedSellShares).toBe(57.66);
    expect(row.PmFillPrice).toBe(0.5);
    expect(row.PmOrigin).toBe("changmen");
    expect(pmBuyLifecycleTagText(row)).toBeNull();
    expect(resolvePmOrderListStatusClass(row)).toBe("Win");
    // 已卖出买单仍展示原始本金（fill×价），不为 0
    expect(pmOrderStakeDisplayCny(row)).toBe(Math.round(57.66 * 0.5 * 6.65));
  });

  it("keeps sports markers when admin orders are rendered through OrderList", () => {
    const row = adminOrderToOrderRow(order({
      provider: "Polymarket",
      game: "football",
      domain: "sports",
      sport: "football",
      source: "football-board",
    }));

    expect(row.Game).toBe("football");
    expect(row.Domain).toBe("sports");
    expect(row.Sport).toBe("football");
    expect(row.Source).toBe("football-board");
  });

  it("uses venueAccountName in player label", () => {
    expect(adminPlayerLabel(
      adminOrderToOrderRow(order({ playerId: 101 }), [account({ accountId: 101 })]),
      [account({ accountId: 101, venueAccountName: "ray_live", playerName: "old" })],
    )).toBe("平博 / ray_live");
  });

  it("falls back to historical player name when account deleted", () => {
    expect(adminPlayerLabel(
      adminOrderToOrderRow(order({ playerId: 255, provider: "OB" }), []),
      [],
      {
        platformName: "2-OD",
        playerName: "ttianjiazhuang1",
        playerDeleted: true,
      },
    )).toBe("2-OD / ttianjiazhuang1（已删）");
  });

  it("keeps deleted mark when historical stub is already merged into accounts", () => {
    const stub = mergeAdminAccountsWithOrderHistory(
      [],
      [order({
        playerId: 255,
        playerName: "ttianjiazhuang1",
        platformName: "2-OD",
        playerDeleted: true,
      })],
    );
    expect(adminPlayerLabel(
      adminOrderToOrderRow(order({ playerId: 255, provider: "OB" }), stub),
      stub,
      {
        platformName: "2-OD",
        playerName: "ttianjiazhuang1",
        playerDeleted: true,
      },
    )).toBe("2-OD / ttianjiazhuang1（已删）");
  });

  it("mergeAdminAccountsWithOrderHistory adds stub for deleted player", () => {
    const merged = mergeAdminAccountsWithOrderHistory(
      [account({ accountId: 101 })],
      [order({
        playerId: 255,
        playerName: "ttianjiazhuang1",
        platformName: "2-OD",
        playerDeleted: true,
      })],
    );
    expect(merged.map(a => a.accountId).sort((a, b) => a - b)).toEqual([101, 255]);
    expect(merged.find(a => a.accountId === 255)).toMatchObject({
      playerName: "ttianjiazhuang1",
      platformName: "2-OD",
      active: false,
      description: "已删除",
    });
  });

  it("groupAdminOrderEntries aligns PM sell link to parent buy before grouping", () => {
    const buyLink = 1_781_300_000_200;
    const sellWrongLink = 1_781_300_000_100;
    const grouped = groupAdminOrderEntries([
      order({
        id: 1,
        orderId: "0xbuy",
        linkId: buyLink,
        provider: "Polymarket",
        pmSide: "buy",
        pmSellState: "closed",
        money: 5,
      }),
      order({
        id: 2,
        orderId: "0xsell",
        linkId: sellWrongLink,
        provider: "Polymarket",
        pmSide: "sell",
        pmBuyOrderId: "0xbuy",
        money: 0,
        betMoney: 40,
      }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.link).toBe(buyLink);
    expect(grouped[0]!.orderRows.map(r => r.OrderID).sort()).toEqual(["0xbuy", "0xsell"]);
    expect(grouped[0]!.orderRows.find(r => r.OrderID === "0xsell")?.Link).toBe(buyLink);
  });

  it("countAdminPrimaryOrders excludes PM/PF sells", () => {
    expect(countAdminPrimaryOrders([
      order({ id: 1, orderId: "ob1", provider: "OB" }),
      order({
        id: 2,
        orderId: "0xbuy",
        provider: "Polymarket",
        pmSide: "buy",
        linkId: 99,
      }),
      order({
        id: 3,
        orderId: "0xsell",
        provider: "Polymarket",
        pmSide: "sell",
        pmBuyOrderId: "0xbuy",
        linkId: 99,
      }),
      order({
        id: 4,
        orderId: "pf-sell",
        provider: "PredictFun",
        pfSide: "sell",
        pfBuyOrderId: "pf-buy",
      }),
    ])).toBe(2);
  });

  it("filterAdminOrdersBelongingToDate keeps cross-day arb on Link bind day only", () => {
    const link = Date.parse("2026-09-04T23:46:13+08:00");
    const yday = Date.parse("2026-09-04T23:46:19+08:00");
    const today = Date.parse("2026-09-05T00:08:27+08:00");
    const ydayKey = toOrderDateKeyLocal(link);
    const todayKey = toOrderDateKeyLocal(today);
    const rows = [
      order({
        id: 1,
        orderId: "ray",
        provider: "RAY",
        linkId: link,
        createAt: yday,
        money: -264,
      }),
      order({
        id: 2,
        orderId: "pm",
        provider: "Polymarket",
        pmSide: "buy",
        linkId: link,
        createAt: today,
        money: 321,
      }),
    ];
    expect(filterAdminOrdersBelongingToDate(rows, ydayKey).map(r => r.orderId).sort())
      .toEqual(["pm", "ray"]);
    expect(filterAdminOrdersBelongingToDate(rows, todayKey)).toEqual([]);
  });
});
