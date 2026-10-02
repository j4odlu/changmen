import { placeholderLinkFromCreateAt } from "@changmen/db";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import { describe, expect, it, vi } from "vitest";
import { listUserProfitRank, parseOrderBindRow, resolveStoredLink } from "./order_store.js";

vi.mock("@changmen/db", () => ({
  fetchOrdersForProfitAggregate: vi.fn(),
  fetchProfiles: vi.fn(),
  fetchPlayersByIdsIncludingDeleted: vi.fn(async () => []),
  fetchOrdersByLinks: vi.fn(async () => []),
  fetchOrdersByUserOrderIds: vi.fn(async () => []),
  fetchPredictionSellsByBuyOrderIds: vi.fn(async () => []),
  placeholderLinkFromCreateAt: (ca) => ca,
  backendBindLinkFromCreateAt: vi.fn(),
}));

describe("parseVenueCreateAt in saveOrder path", () => {
  it("parses datetime strings that parseNum would drop", () => {
    const ts = parseVenueCreateAt("2026-06-14 15:30:00");
    expect(ts).toBe(Date.parse("2026-06-14T15:30:00"));
  });

  it("reads CreateAt PascalCase shape", () => {
    expect(parseVenueCreateAt(undefined)).toBeGreaterThan(0);
    expect(parseVenueCreateAt(1700000000000)).toBe(1700000000000);
  });
});

describe("resolveStoredLink", () => {
  it("uses create_at placeholder when link is 0", () => {
    const ca = 1_781_882_462_790;
    expect(resolveStoredLink(0, "order-1", ca)).toBe(ca);
    expect(resolveStoredLink(0, "order-1", ca)).toBe(placeholderLinkFromCreateAt(ca));
  });

  it("keeps non-zero stored link", () => {
    expect(resolveStoredLink(1_700_000_000_123, "o", 99)).toBe(1_700_000_000_123);
  });
});

describe("parseOrderBindRow", () => {
  it("reads A8-style nA fields", () => {
    expect(
      parseOrderBindRow({
        LinkID: 1710000000123,
        Provider: "OB",
        OrderID: "venue-99",
      }),
    ).toEqual({
      orderId: "venue-99",
      playerId: 0,
      linkId: 1710000000123,
      provider: "OB",
    });
  });

  it("reads changmen extensions with PlayerID", () => {
    expect(
      parseOrderBindRow({
        LinkID: 42,
        Provider: "RAY",
        OrderID: "r-1",
        PlayerID: 7,
      }),
    ).toEqual({
      orderId: "r-1",
      playerId: 7,
      linkId: 42,
      provider: "RAY",
    });
  });

  it("skips empty orderId or linkId in saveOrderBind loop", () => {
    const row = parseOrderBindRow({ LinkID: 0, OrderID: "x", Provider: "PB" });
    expect(row.linkId).toBe(0);
    expect(row.orderId).toBe("x");
  });
});

describe("listUserProfitRank", () => {
  it("allows administrators to opt into the rank and exclude themselves again", async () => {
    const sb = await import("@changmen/db");
    const adminProfile = { id: "a1", user_name: "admin", role: "admin", leaderboard_excluded: null };
    vi.mocked(sb.fetchProfiles).mockResolvedValue([adminProfile]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      { user_id: "a1", status: "Win", money: 100, bet_money: 500 },
    ]);
    expect(await listUserProfitRank("2026-06-30")).toEqual([]);
    adminProfile.leaderboard_excluded = false;
    const rows = await listUserProfitRank("2026-06-30");
    expect(rows.map(row => row.UserName)).toEqual(["admin"]);
    expect(rows[0].Money).toBe(100);
    expect(rows[0].Count).toBe(1);
    adminProfile.leaderboard_excluded = true;
    expect(await listUserProfitRank("2026-06-30")).toEqual([]);
  });
  it("excludes configured users and preserves their admin statistics; restoring re-enters rank", async () => {
    const sb = await import("@changmen/db");
    const profiles = [
      { id: "u1", user_name: "alice", leaderboard_excluded: true },
      { id: "u2", user_name: "bob" },
      { id: "u3", user_name: "admin", role: "admin" },
    ];
    vi.mocked(sb.fetchProfiles).mockResolvedValue(profiles);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      { user_id: "u1", status: "Win", money: 100, bet_money: 500 },
      { user_id: "u2", status: "Lose", money: -50, bet_money: 100 },
      { user_id: "u3", status: "Win", money: 999, bet_money: 9000 },
    ]);
    expect((await listUserProfitRank("2026-06-30")).map(r => r.UserName)).toEqual(["bob"]);
    const adminRows = await listUserProfitRank("2026-06-30", { includeExcluded: true });
    expect(adminRows.map(r => r.UserName)).toEqual(["alice", "bob"]);
    expect(adminRows[0].Money).toBe(100);
    profiles[0].leaderboard_excluded = false;
    expect((await listUserProfitRank("2026-06-30")).map(r => r.UserName)).toEqual(["alice", "bob"]);
  });
  it("excludes admin users from rank rows", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchProfiles).mockResolvedValue([
      { id: "u1", user_name: "alice", is_admin: false, role: "user" },
      { id: "u2", user_name: "admin", is_admin: true, role: "admin" },
    ]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      { user_id: "u1", status: "Win", money: 100, bet_money: 500 },
      { user_id: "u2", status: "Win", money: 999, bet_money: 9000 },
    ]);

    const rows = await listUserProfitRank("2026-06-30");

    expect(rows).toHaveLength(1);
    expect(rows[0].UserName).toBe("alice");
    expect(rows[0].Money).toBe(100);
  });

  it("excludes sports-marked orders from the esport profit rank", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchProfiles).mockResolvedValue([
      { id: "u1", user_name: "alice", is_admin: false, role: "user" },
    ]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      { user_id: "u1", provider: "OB", status: "Win", money: 100, bet_money: 500 },
      {
        user_id: "u1",
        provider: "Polymarket",
        status: "Win",
        money: 999,
        bet_money: 9000,
        raw: { domain: "sports", sport: "football" },
      },
    ]);

    const rows = await listUserProfitRank("2026-09-21");

    expect(rows).toHaveLength(1);
    expect(rows[0].Money).toBe(100);
    expect(rows[0].BetMoney).toBe(500);
  });

  it("scales PredictFun USDT money/bet_money to CNY (matches frontend today P&L)", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchProfiles).mockResolvedValue([
      { id: "u1", user_name: "GB12", is_admin: false, role: "user" },
    ]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      { user_id: "u1", provider: "OB", status: "Win", money: 43.3752, bet_money: 200 },
      {
        user_id: "u1",
        provider: "PredictFun",
        status: "None",
        money: 29.71,
        bet_money: 27.21,
        raw: { pfSide: "buy" },
      },
      {
        user_id: "u1",
        provider: "PredictFun",
        status: "None",
        money: 0,
        bet_money: 56.92,
        raw: { pfSide: "sell" },
      },
    ]);

    const rows = await listUserProfitRank("2026-07-24");

    expect(rows).toHaveLength(1);
    // 43.3752 + 29.71 * 6.7
    expect(rows[0].Money).toBeCloseTo(242.4322, 4);
    expect(rows[0].Count).toBe(2);
    expect(rows[0].BetMoney).toBeCloseTo(200 + 27.21 * 6.7, 4);
  });

  it("dedupes same order_id across player_id (deleted+readded account)", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchProfiles).mockResolvedValue([
      { id: "u1", user_name: "GB17", is_admin: false, role: "user" },
    ]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([
      {
        id: 1,
        user_id: "u1",
        player_id: 200,
        order_id: "1837201350013222349",
        provider: "OB",
        status: "Lose",
        money: -100,
        bet_money: 100,
      },
      {
        id: 2,
        user_id: "u1",
        player_id: 255,
        order_id: "1837201350013222349",
        provider: "OB",
        status: "Lose",
        money: -100,
        bet_money: 100,
      },
      {
        id: 3,
        user_id: "u1",
        player_id: 200,
        order_id: "1845490493399475642",
        provider: "OB",
        status: "Win",
        money: 55.7,
        bet_money: 100,
      },
      {
        id: 4,
        user_id: "u1",
        player_id: 255,
        order_id: "1845490493399475642",
        provider: "OB",
        status: "Win",
        money: 55.7,
        bet_money: 100,
      },
      {
        id: 5,
        user_id: "u1",
        player_id: 255,
        order_id: "other",
        provider: "OB",
        status: "Win",
        money: 200,
        bet_money: 100,
      },
    ]);

    const rows = await listUserProfitRank("2026-07-29");
    expect(rows).toHaveLength(1);
    // -100 + 55.7 + 200??? order_id ?????
    expect(rows[0].Money).toBeCloseTo(155.7, 4);
    expect(rows[0].Count).toBe(3);
  });

  it("books cross-day arb P&L on the Link bind day", async () => {
    const sb = await import("@changmen/db");
    const ydayAt = Date.parse("2026-09-04T23:46:19+08:00");
    const todayAt = Date.parse("2026-09-05T00:08:27+08:00");
    const ray = {
      id: 1,
      user_id: "u1",
      order_id: "ray-1",
      link: 1_788_536_773_449,
      create_at: ydayAt,
      provider: "RAY",
      status: "Lose",
      money: -264,
      bet_money: 264,
    };
    const pm = {
      id: 2,
      user_id: "u1",
      order_id: "pm-1",
      link: 1_788_536_773_449,
      create_at: todayAt,
      provider: "Polymarket",
      status: "Win",
      money: 321,
      bet_money: 279,
      raw: { pmSide: "buy" },
    };
    vi.mocked(sb.fetchProfiles).mockResolvedValue([
      { id: "u1", user_name: "GB18", is_admin: false, role: "user" },
    ]);
    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([ray]);
    vi.mocked(sb.fetchOrdersByLinks).mockResolvedValue([ray, pm]);
    const home = await listUserProfitRank("2026-09-04");
    expect(home).toHaveLength(1);
    expect(home[0].Money).toBe(57);
    expect(home[0].Count).toBe(2);

    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([pm]);
    vi.mocked(sb.fetchOrdersByLinks).mockResolvedValue([ray, pm]);
    const later = await listUserProfitRank("2026-09-05");
    expect(later).toHaveLength(0);

    vi.mocked(sb.fetchOrdersForProfitAggregate).mockResolvedValue([pm]);
    vi.mocked(sb.fetchOrdersByLinks).mockResolvedValue([pm]);
    const bindDayMakeupOnly = await listUserProfitRank("2026-09-04");
    expect(bindDayMakeupOnly).toHaveLength(1);
    expect(bindDayMakeupOnly[0].Money).toBe(321);
  });
});

describe("mergeOrderLogicalSave buy stake after manual sell", () => {
  it("keeps original betMoney and accumulates money when closing a buy", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const prevRaw = {
      pmOrigin: "changmen",
      pmSide: "buy",
      betMoney: 111.52,
      pmStakeUsdc: 16.4,
      pmShares: 48.2353,
      pmAttributedSellShares: 0,
      money: 0,
      status: "none",
    };
    const incoming = {
      provider: "Polymarket",
      pmOrigin: "changmen",
      pmSide: "buy",
      betMoney: 111.52,
      pmStakeUsdc: 0,
      pmSellState: "closed",
      pmAttributedSellShares: 48.2353,
      money: 3,
      status: "none",
    };
    const { raw, bet_money, money } = mergeOrderLogicalSave(
      { bet_money: 111.52, money: 0 },
      prevRaw,
      incoming,
      "changmen",
    );
    expect(bet_money).toBe(111.52);
    expect(raw.betMoney).toBe(111.52);
    expect(raw.pmSellState).toBe("closed");
    expect(raw.pmStakeUsdc).toBe(0);
    expect(money).toBe(3);
  });

  it("stores and preserves pmSellProceeds on buy (PF-aligned)", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const first = mergeOrderLogicalSave(
      { bet_money: 100, money: 0 },
      {
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmStakeUsdc: 10,
        pmShares: 20,
        money: 0,
        status: "none",
      },
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmStakeUsdc: 0,
        pmSellState: "closed",
        pmAttributedSellShares: 20,
        pmSellProceeds: 11.5,
        pmLastSellOrderId: "0xsell",
        money: 10,
        status: "none",
      },
      "changmen",
    );
    expect(first.raw.pmSellProceeds).toBe(11.5);
    expect(first.raw.pmLastSellOrderId).toBe("0xsell");

    // sync 省略卖单字段时，保留既有卖单账本（proceeds / lastSellOrderId / money 不被清零）
    const wiped = mergeOrderLogicalSave(
      { bet_money: 100, money: 10 },
      first.raw,
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "closed",
        pmAttributedSellShares: 20,
        money: 0,
        status: "none",
      },
      "changmen",
    );
    expect(wiped.raw.pmSellProceeds).toBe(11.5);
    expect(wiped.raw.pmLastSellOrderId).toBe("0xsell");
    expect(wiped.money).toBe(10);
  });

  it("preserves positionEvents.sells when sync omits them; upserts by id", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const first = mergeOrderLogicalSave(
      { bet_money: 100, money: 0 },
      { pmSide: "buy", pmOrigin: "changmen" },
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "partial",
        pmAttributedSellShares: 5,
        pmSellProceeds: 3,
        pmLastSellOrderId: "0xs1",
        money: 1,
        positionEvents: {
          sells: [{ id: "0xs1", at: 10, shares: 5, proceeds: 3, origin: "changmen" }],
        },
      },
      "changmen",
    );
    expect(first.raw.positionEvents.sells).toHaveLength(1);

    const syncWipe = mergeOrderLogicalSave(
      { bet_money: 100, money: 1 },
      first.raw,
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "partial",
        pmAttributedSellShares: 5,
        money: 0,
      },
      "changmen",
    );
    expect(syncWipe.raw.positionEvents.sells).toHaveLength(1);
    expect(syncWipe.raw.positionEvents.sells[0].id).toBe("0xs1");

    const second = mergeOrderLogicalSave(
      { bet_money: 100, money: 1 },
      syncWipe.raw,
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "closed",
        pmAttributedSellShares: 10,
        pmSellProceeds: 7,
        pmLastSellOrderId: "0xs2",
        money: 2,
        positionEvents: {
          sells: [{ id: "0xs2", at: 20, shares: 5, proceeds: 4, origin: "changmen" }],
        },
      },
      "changmen",
    );
    expect(second.raw.positionEvents.sells.map(s => s.id)).toEqual(["0xs1", "0xs2"]);

    const retrySame = mergeOrderLogicalSave(
      { bet_money: 100, money: 2 },
      second.raw,
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        positionEvents: {
          sells: [{ id: "0XS2", at: 20, shares: 5, proceeds: 4.1, origin: "changmen" }],
        },
      },
      "changmen",
    );
    expect(retrySame.raw.positionEvents.sells).toHaveLength(2);
    expect(retrySame.raw.positionEvents.sells.find(s => s.id.toLowerCase() === "0xs2").proceeds)
      .toBe(4.1);
  });

  it("PF buy keeps positionEvents even if stray pmSide=sell is present", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const prev = {
      pfSide: "buy",
      positionEvents: {
        sells: [{ id: "0xpf1", at: 1, shares: 1, proceeds: 2, origin: "changmen" }],
      },
    };
    const { raw } = mergeOrderLogicalSave(
      { bet_money: 10, money: 1 },
      prev,
      {
        provider: "PredictFun",
        pfSide: "buy",
        // ??????? pmSide ???????????
        pmSide: "sell",
        betMoney: 10,
        money: 1,
      },
    );
    expect(raw.positionEvents.sells).toHaveLength(1);
    expect(raw.positionEvents.sells[0].id).toBe("0xpf1");
  });

  it("does not invent pmSellProceeds=0 on legacy closed sync", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw } = mergeOrderLogicalSave(
      { bet_money: 100, money: 10 },
      {
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "closed",
        pmAttributedSellShares: 20,
        money: 10,
        status: "none",
      },
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 100,
        pmSellState: "closed",
        pmAttributedSellShares: 20,
        money: 0,
        status: "none",
      },
      "changmen",
    );
    expect(raw.pmSellProceeds).toBeUndefined();
    expect(raw.money).toBe(10);
  });

  it("keeps original betMoney on first partial sell patch", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const prevRaw = {
      pmOrigin: "changmen",
      pmSide: "buy",
      betMoney: 112,
      pmStakeUsdc: 16.4,
      pmShares: 48.23,
      money: 0,
      status: "none",
    };
    const incoming = {
      provider: "Polymarket",
      pmOrigin: "changmen",
      pmSide: "buy",
      betMoney: 112,
      pmStakeUsdc: 5.9,
      pmSellState: "partial",
      pmAttributedSellShares: 30,
      money: 8,
      status: "none",
    };
    const { raw, bet_money, money } = mergeOrderLogicalSave(
      { bet_money: 112, money: 0 },
      prevRaw,
      incoming,
      "changmen",
    );
    expect(bet_money).toBe(112);
    expect(raw.betMoney).toBe(112);
    expect(raw.pmStakeUsdc).toBe(5.9);
    expect(raw.pmSellState).toBe("partial");
    expect(money).toBe(8);
  });

  it("forces sell money to 0 when sync sends money=0 (PnL lives on buy)", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const prevRaw = {
      pmOrigin: "changmen",
      pmSide: "sell",
      betMoney: 115,
      money: 3,
      pmBuyOrderId: "0xbuy",
    };
    const incoming = {
      provider: "Polymarket",
      pmOrigin: "changmen",
      pmSide: "sell",
      betMoney: 115,
      money: 0,
      pmBuyOrderId: "0xbuy",
    };
    const { money, raw } = mergeOrderLogicalSave(
      { bet_money: 115, money: 3 },
      prevRaw,
      incoming,
      "changmen",
    );
    expect(money).toBe(0);
    expect(raw.money).toBe(0);
  });
});

describe("mergeOrderLogicalSave PredictFun partial sync", () => {
  it("keeps pfSellState/pfSide/pfBuyOrderId when incoming omits them", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw, money, bet_money } = mergeOrderLogicalSave(
      { bet_money: 80, money: 9 },
      {
        pfSide: "buy",
        pfSellState: "closing",
        pfBuyOrderId: "parent-should-not-apply",
        pfTokenId: "tok",
        pfMarketId: "mkt",
        money: 9,
        betMoney: 80,
      },
      {
        provider: "PredictFun",
        pfFeeRateBps: 50,
        money: 0,
        betMoney: 0,
      },
      undefined,
    );
    expect(raw.pfSide).toBe("buy");
    expect(raw.pfSellState).toBe("closing");
    expect(raw.pfTokenId).toBe("tok");
    expect(raw.pfMarketId).toBe("mkt");
    expect(money).toBe(9);
    expect(bet_money).toBe(80);
  });

  it("forces PF sell money to 0; keeps betMoney proceeds mirror", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { money, bet_money, raw } = mergeOrderLogicalSave(
      { bet_money: 40, money: 2 },
      {
        pfSide: "sell",
        pfBuyOrderId: "0xpfbuy",
        money: 2,
        betMoney: 40,
      },
      {
        provider: "PredictFun",
        pfSide: "sell",
        pfBuyOrderId: "0xpfbuy",
        money: 0,
        betMoney: 0,
      },
      undefined,
    );
    expect(money).toBe(0);
    expect(raw.money).toBe(0);
    expect(bet_money).toBe(40);
  });
});

describe("mergeOrderLogicalSave parallel branches (characterization)", () => {
  it("OB venue still preserves stray pfFee* from prev (historical non-PM tail)", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw, money, bet_money } = mergeOrderLogicalSave(
      { bet_money: 10, money: 0 },
      {
        pfFeeAmountWei: "1000",
        pfFeeType: "SHARES",
        pfFeeUsdt: 0.1,
        pfFeeRateBps: 50,
      },
      {
        provider: "OB",
        status: "Pending",
        betMoney: 10,
        money: 0,
      },
      undefined,
    );
    expect(raw.pfFeeAmountWei).toBe("1000");
    expect(raw.pfFeeType).toBe("SHARES");
    expect(raw.pfFeeRateBps).toBe(50);
    expect(money).toBe(0);
    expect(bet_money).toBe(10);
    // ???? PF ????????? pfSide
    expect(raw.pfSide).toBeUndefined();
  });

  it("OB does not apply PF money empty-write guard", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { money, bet_money } = mergeOrderLogicalSave(
      { bet_money: 80, money: 12 },
      { money: 12, betMoney: 80 },
      {
        provider: "OB",
        money: 0,
        betMoney: 0,
      },
      undefined,
    );
    // ???????? PF ??? money/bet
    expect(money).toBe(0);
    expect(bet_money).toBe(0);
  });

  it("PM buy preserves max fill shares and fillPrice", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw, bet_money, money } = mergeOrderLogicalSave(
      { bet_money: 50, money: 0 },
      {
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 50,
        pmShares: 20,
        pmFillPrice: 0.42,
        money: 0,
        status: "none",
      },
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "buy",
        betMoney: 50,
        pmShares: 0,
        pmFillPrice: 0,
        money: 0,
        status: "none",
      },
      "changmen",
    );
    expect(raw).toMatchObject({
      pmSide: "buy",
      pmShares: 20,
      pmFillPrice: 0.42,
      betMoney: 50,
    });
    expect(bet_money).toBe(50);
    expect(money).toBe(0);
  });

  it("PM changmen sell keeps buy id; money forced to 0 when sync sends 0", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw, bet_money, money } = mergeOrderLogicalSave(
      { bet_money: 12, money: 3.5 },
      {
        pmOrigin: "changmen",
        pmSide: "sell",
        pmBuyOrderId: "0xBuyParent",
        betMoney: 12,
        money: 3.5,
        status: "none",
      },
      {
        provider: "Polymarket",
        pmOrigin: "changmen",
        pmSide: "sell",
        betMoney: 0,
        money: 0,
        status: "none",
      },
      "changmen",
    );
    expect(raw).toMatchObject({
      pmSide: "sell",
      pmOrigin: "changmen",
      pmBuyOrderId: "0xBuyParent",
    });
    expect(money).toBe(0);
    expect(bet_money).toBe(12);
  });

  it("PF keeps identity fields on partial sync (characterization)", async () => {
    const { mergeOrderLogicalSave } = await import("./order_store.js");
    const { raw, money, bet_money } = mergeOrderLogicalSave(
      { bet_money: 40, money: 2 },
      {
        pfSide: "buy",
        pfSellState: "open",
        pfBuyOrderId: "",
        pfTokenId: "tok-1",
        pfMarketId: "mkt-9",
        pfOrderHash: "0xhash",
        pfApiOrderId: "api-1",
        money: 2,
        betMoney: 40,
      },
      {
        provider: "PredictFun",
        status: "Pending",
        money: 0,
        betMoney: 0,
      },
      undefined,
    );
    expect(raw).toMatchObject({
      pfSide: "buy",
      pfSellState: "open",
      pfTokenId: "tok-1",
      pfMarketId: "mkt-9",
      pfOrderHash: "0xhash",
      pfApiOrderId: "api-1",
      money: 2,
      betMoney: 40,
    });
    expect(money).toBe(2);
    expect(bet_money).toBe(40);
  });
});

describe("rowToOrder sell money zeroing", () => {
  it("exposes PM POD football ids for client-side duplicate guards", async () => {
    const { rowToOrder } = await import("./order_store.js");
    const o = rowToOrder({
      order_id: "0xpod",
      provider: "Polymarket",
      money: 0,
      bet_money: 50,
      create_at: 1,
      link: 1,
      raw: {
        domain: "sports",
        sport: "football",
        source: "football-pod",
        podClientId: "pod-1",
        podPmMatchId: "pm-match-1",
        pmSide: "buy",
      },
    });
    expect(o.Domain).toBe("sports");
    expect(o.Sport).toBe("football");
    expect(o.Source).toBe("football-pod");
    expect(o.PodClientId).toBe("pod-1");
    expect(o.PodPmMatchId).toBe("pm-match-1");
  });

  it("zeros Polymarket sell Money on read", async () => {
    const { rowToOrder } = await import("./order_store.js");
    const o = rowToOrder({
      order_id: "0xsell",
      provider: "Polymarket",
      money: 12,
      bet_money: 40,
      create_at: 1,
      link: 1,
      raw: { pmSide: "sell", pmBuyOrderId: "0xbuy" },
    });
    expect(o.Money).toBe(0);
    expect(o.BetMoney).toBe(40);
  });

  it("does not zero PredictFun buy Money when stray pmSide=sell is present", async () => {
    const { rowToOrder } = await import("./order_store.js");
    const o = rowToOrder({
      order_id: "0xpfbuy",
      provider: "PredictFun",
      money: 9,
      bet_money: 80,
      create_at: 1,
      link: 1,
      raw: { pfSide: "buy", pmSide: "sell" },
    });
    expect(o.Money).toBe(9);
    expect(o.PfSide).toBe("buy");
  });

  it("zeros PredictFun sell Money on read", async () => {
    const { rowToOrder } = await import("./order_store.js");
    const o = rowToOrder({
      order_id: "0xpfsell",
      provider: "PredictFun",
      money: 2,
      bet_money: 40,
      create_at: 1,
      link: 1,
      raw: { pfSide: "sell", pfBuyOrderId: "0xpfbuy" },
    });
    expect(o.Money).toBe(0);
  });
});

describe("attachPlayerDisplayToClientOrders", () => {
  it("fills Player.UserName from soft-deleted player (venueAccountName first)", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchPlayersByIdsIncludingDeleted).mockResolvedValue([
      {
        id: 42,
        playerId: 42,
        platformName: "雷速",
        playerName: "legacy",
        deletedAt: 1_700_000_000_000,
        accountData: { venueAccountName: "venue-user" },
      },
    ]);
    const { attachPlayerDisplayToClientOrders } = await import("./order_store.js");
    const list = await attachPlayerDisplayToClientOrders([
      {
        OrderID: "o1",
        PlayerID: 42,
        Type: "RAY",
        Player: { Platform: "RAY", UserName: "", Status: "None" },
      },
    ]);
    expect(list[0].Player.Platform).toBe("雷速");
    expect(list[0].Player.UserName).toBe("venue-user");
    expect(list[0].PlayerDeleted).toBe(true);
  });

  it("leaves orders untouched when player row missing", async () => {
    const sb = await import("@changmen/db");
    vi.mocked(sb.fetchPlayersByIdsIncludingDeleted).mockResolvedValue([]);
    const { attachPlayerDisplayToClientOrders } = await import("./order_store.js");
    const input = [{
      OrderID: "o2",
      PlayerID: 99,
      Player: { Platform: "OB", UserName: "", Status: "None" },
    }];
    const list = await attachPlayerDisplayToClientOrders(input);
    expect(list[0].Player.UserName).toBe("");
    expect(list[0].PlayerDeleted).toBeUndefined();
  });
});
