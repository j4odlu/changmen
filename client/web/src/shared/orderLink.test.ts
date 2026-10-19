import { LoseOrder } from "@/models/loseOrder";
import { Currency, getExchange } from "@changmen/shared/currency";
import { describe, expect, it } from "vitest";
import {
  canRebindOrderLinkTo,
  canRebindOrderOnto,
  isSameOrderMatchMap,
  compareOrderLinkDesc,
  computeOrderGroupProfit,
  countPrimaryOrderRows,
  dropOrphanPolymarketSellGroups,
  filterOrdersBelongingToDate,
  alignPredictionSellLinksToBuys,
  effectiveOrderLink,
  groupOrdersByEffectiveLink,
  groupOrdersByLink,
  isLinkedArbOrderGroup,
  isRebindableOrderRow,
  linkIdGroupKey,
  loseOrderToPendingRow,
  makeupPendingProfitLabel,
  mergePendingMakeupIntoOrderGroups,
  orderLinkLegend,
  orderListDisplayBlocks,
  orderListDisplayRows,
  orderGroupHomeTs,
  orderProfitDateTs,
  sortOrdersByLinkDesc,
  toOrderDateKeyLocal,
} from "./orderLink";

describe("orderLink A8 parity", () => {
  it("linkIdGroupKey uses Link as-is", () => {
    expect(linkIdGroupKey(1_700_000_000_123)).toBe(1_700_000_000_123);
    expect(linkIdGroupKey(-1_700_000_000_123)).toBe(-1_700_000_000_123);
    expect(linkIdGroupKey(undefined)).toBe(0);
  });

  it("sortOrdersByLinkDesc orders groups by Link descending", () => {
    const sorted = sortOrdersByLinkDesc([
      { Link: 100 },
      { Link: 300 },
      { Link: 200 },
    ]);
    expect(sorted.map(r => r.Link)).toEqual([300, 200, 100]);
  });

  it("compareOrderLinkDesc matches A8 bundle comparator", () => {
    expect(compareOrderLinkDesc({ Link: 300 }, { Link: 100 })).toBe(-1);
    expect(compareOrderLinkDesc({ Link: 100 }, { Link: 300 })).toBe(1);
    expect(compareOrderLinkDesc({ Link: 100 }, { Link: 100 })).toBe(1);
  });

  it("sorts valueBet link by decoded timestamp alongside arb/9999", () => {
    const ts = 1_780_000_000_500;
    const vb = -(7_000_000_000_000_000 + ts);
    const sorted = sortOrdersByLinkDesc([
      { Link: ts - 100 },
      { Link: vb },
      { Link: -(ts - 50) },
    ]);
    expect(sorted.map(r => r.Link)).toEqual([vb, -(ts - 50), ts - 100]);
  });

  it("groups two legs with the same Link", () => {
    const link = 1_700_000_000_999;
    const grouped = groupOrdersByLink([
      { OrderID: "a", Link: link, CreateAt: 2000 },
      { OrderID: "b", Link: link, CreateAt: 1000 },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get(link)?.map(r => r.OrderID)).toEqual(["a", "b"]);
  });

  it("legend joins unsettled preview with slash", () => {
    const text = orderLinkLegend([
      { Status: "None", BetMoney: 100, Odds: 2.0, Money: 0, Type: "OB", Item: "Home", OrderID: "a" },
      { Status: "None", BetMoney: 100, Odds: 2.2, Money: 0, Type: "RAY", Item: "Away", OrderID: "b" },
    ]);
    expect(text).toContain(" / ");
  });

  it("legend joins unsettled OB + PM preview without double-dash", () => {
    const fx = 6.7;
    const text = orderLinkLegend([
      { Status: "None", BetMoney: 100, Odds: 3.0, Money: 0, Type: "OB", Item: "Alpha", OrderID: "a" },
      {
        Status: "None",
        BetMoney: 100,
        Odds: 1.8,
        Money: 0,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Beta",
        OrderID: "b",
        PmTokenId: "tok-b",
        // 份额×$1 对齐旧「本金×赔率」回款：100*1.8 CNY
        PmShares: (100 * 1.8) / fx,
        PmFillPrice: 1 / 1.8,
      },
    ]);
    // stake=200; OB: 100*3-200=100; PM: 180-200=-20
    expect(text).toBe("-20 / 100");
  });

  it("legend does not merge venue order into PM by team/Item name", () => {
    const fx = 6.7;
    const text = orderLinkLegend([
      {
        OrderID: "pm-geng",
        Status: "None",
        BetMoney: 50,
        Odds: 1.408,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Gen.G Esports",
        PmTokenId: "tok-geng",
        PmShares: (50 * 1.408) / fx,
        PmFillPrice: 1 / 1.408,
      },
      {
        OrderID: "od-geng",
        Status: "None",
        BetMoney: 182,
        Odds: 1.3,
        Type: "OD",
        Item: "Gen.G Esports",
      },
      {
        OrderID: "pm-ns",
        Status: "None",
        BetMoney: 119,
        Odds: 2.857,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Nongshim RedForce",
        PmTokenId: "tok-ns",
        PmShares: (119 * 2.857) / fx,
        PmFillPrice: 1 / 2.857,
      },
    ]);
    // stake=351; PM geng / PM ns / OD 各算：约 -281 / -11 / -114
    expect(text).toBe("-281 / -11 / -114");
  });

  it("legend keeps venue orders per-order; only PM same-token merges", () => {
    const fx = 6.7;
    const text = orderLinkLegend([
      {
        OrderID: "pm-trace",
        Status: "None",
        BetMoney: 50,
        Odds: 1.587,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Trace Esports",
        PmTokenId: "token-trace",
        PmShares: (50 * 1.587) / fx,
        PmFillPrice: 1 / 1.587,
      },
      {
        OrderID: "pm-nova-a",
        Status: "None",
        BetMoney: 50,
        Odds: 1.388,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Nova Esports",
        PmTokenId: "token-nova",
        PmShares: (50 * 1.388) / fx,
        PmFillPrice: 1 / 1.388,
      },
      {
        OrderID: "pm-nova-b",
        Status: "None",
        BetMoney: 50,
        Odds: 1.298,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Nova Esports",
        PmTokenId: "token-nova",
        PmShares: (50 * 1.298) / fx,
        PmFillPrice: 1 / 1.298,
      },
      {
        OrderID: "pm-nova-c",
        Status: "None",
        BetMoney: 260,
        Odds: 1.428,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Nova Esports",
        PmTokenId: "token-nova",
        PmShares: (260 * 1.428) / fx,
        PmFillPrice: 1 / 1.428,
      },
      {
        OrderID: "ray-te",
        Status: "None",
        BetMoney: 164,
        Odds: 2.35,
        Type: "RAY",
        Item: "TE",
      },
      {
        OrderID: "ray-nv-reject",
        Status: "Reject",
        BetMoney: 164,
        Odds: 2.35,
        Type: "RAY",
        Item: "NV",
      },
    ]);
    // stake=574; Trace / Nova(merged) / RAY TE ≈ -495 / -68 / -189
    expect(text).toBe("-495 / -68 / -189");
  });

  it("legend merges PM same-token buys even when Item text differs slightly", () => {
    const fx = 6.7;
    const text = orderLinkLegend([
      {
        OrderID: "a",
        Status: "None",
        BetMoney: 100,
        Odds: 2,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Team A",
        PmTokenId: "tok-a",
        PmShares: (100 * 2) / fx,
        PmFillPrice: 0.5,
      },
      {
        OrderID: "b",
        Status: "None",
        BetMoney: 50,
        Odds: 2,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Team A (extra)",
        PmTokenId: "tok-a",
        PmShares: (50 * 2) / fx,
        PmFillPrice: 0.5,
      },
      {
        OrderID: "c",
        Status: "None",
        BetMoney: 100,
        Odds: 2.2,
        Type: "Polymarket",
        PmSide: "buy",
        Item: "Team B",
        PmTokenId: "tok-b",
        PmShares: (100 * 2.2) / fx,
        PmFillPrice: 1 / 2.2,
      },
    ]);
    // stake=250; A: 100*2+50*2-250=50; B: 100*2.2-250=-30
    expect(text).toBe("50 / -30");
  });

  it("PM unsettled uses shares×$1 − stake (price path, no odds)", () => {
    // 50 份 × $1 − 25U 成本 → 25U × 6.7 = 167.5 → "168"
    const text = orderLinkLegend([
      {
        Status: "None",
        BetMoney: 168,
        Odds: 2.0,
        Money: 0,
        Type: "Polymarket",
        PmSide: "buy",
        PmShares: 50,
        PmStakeUsdc: 25,
        PmFillPrice: 0.5,
      },
    ]);
    expect(text).toBe("168");
  });

  it("PF unsettled legend uses shares×$1 − notional (price path)", () => {
    // 名义 14.12、价 0.32 → 44.125 份；若赢回款 44.125U，盈利 30.005×6.7≈201
    const text = orderLinkLegend([
      {
        Status: "None",
        Type: "PredictFun",
        PfSide: "buy",
        BetMoney: 13.68,
        PfNotionalUsdt: 14.12,
        PfBookPrice: 0.32,
        PfShares: 44.125,
        Odds: 3.125,
        Money: 0,
        OrderID: "pf1",
      },
    ]);
    expect(text).toBe("201");
  });

  it("PF unsettled legend uses truncated hold × $1 for win payout", () => {
    // 持仓展示/回款截断 43.33 − 名义 14.12 = 29.21U → ×6.7 ≈ 196
    const text = orderLinkLegend([
      {
        Status: "None",
        Type: "PredictFun",
        PfSide: "buy",
        PfNotionalUsdt: 14.12,
        PfBookPrice: 0.32,
        PfShares: 44.125,
        PfHoldShares: 43.33075,
        Odds: 3.125,
        Money: 0,
        OrderID: "pf1",
      },
    ]);
    expect(text).toBe("196");
  });

  it("9999 单边 link 在 legend 前缀展示 🏆", () => {
    const link = -1_700_000_000_123;
    const text = orderLinkLegend([
      { Link: link, Status: "None", BetMoney: 100, Odds: 2.0, Money: 0 },
    ]);
    expect(text.startsWith("🏆")).toBe(true);
  });

  it("正 EV link 在 legend 前缀展示 💎", () => {
    const link = -(7_000_000_000_000_000 + 1_700_000_000_123);
    const text = orderLinkLegend([
      { Link: link, Status: "None", BetMoney: 100, Odds: 2.0, Money: 0 },
    ]);
    expect(text.startsWith("💎")).toBe(true);
  });

  it("computeOrderGroupProfit uses buy Money only; sell Money ignored", () => {
    const profitZeroBuy = computeOrderGroupProfit([
      { Type: "OB", Money: 10 },
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 0, Status: "None", PmSellState: "closed" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 15, BetMoney: 85, PmBuyOrderId: "buy" },
    ]);
    expect(profitZeroBuy).toBe(10);

    const profitNew = computeOrderGroupProfit([
      { Type: "OB", Money: 10 },
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 15, Status: "None", PmSellState: "closed" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 15, BetMoney: 85, PmBuyOrderId: "buy" },
    ]);
    // 买单已有盈亏时不计卖单，防双计
    expect(profitNew).toBe(25);
  });

  it("computeOrderGroupProfit does not double-count when both have Money", () => {
    const profit = computeOrderGroupProfit([
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 184, Status: "None", PmSellState: "settled" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 184, BetMoney: 384, PmBuyOrderId: "buy" },
    ]);
    expect(profit).toBe(184);
  });

  it("PF computeOrderGroupProfit uses buy Money only; sell BetMoney ignored", () => {
    const profit = computeOrderGroupProfit([
      {
        OrderID: "0xbuy",
        Type: "PredictFun",
        PfSide: "buy",
        Money: 3.75,
        BetMoney: 10,
        PfSellState: "closed",
        PfSellProceeds: 13.75,
        Status: "None",
      },
      {
        OrderID: "0xsell",
        Type: "PredictFun",
        PfSide: "sell",
        Money: 0,
        BetMoney: 13.75,
        PfBuyOrderId: "0xbuy",
        Status: "None",
      },
    ]);
    // Money 为 USDT，图例 × 汇率 6.7
    expect(profit).toBe(3.75 * 6.7);
  });

  it("orderListDisplayBlocks nests PM/PF sells under matching buys", () => {
    const blocks = orderListDisplayBlocks([
      { OrderID: "ob1", Type: "OB", Link: 1, Status: "None", BetMoney: 100, Money: 0 },
      {
        OrderID: "buy",
        Type: "Polymarket",
        Link: 1,
        PmSide: "buy",
        Status: "None",
        PmSellState: "closed",
        BetMoney: 100,
        Money: 20,
        CreateAt: 100,
      },
      {
        OrderID: "sell",
        Type: "Polymarket",
        Link: 1,
        PmSide: "sell",
        PmBuyOrderId: "buy",
        Status: "None",
        BetMoney: 120,
        Money: 0,
        CreateAt: 200,
      },
      {
        OrderID: "orphan-sell",
        Type: "Polymarket",
        Link: 1,
        PmSide: "sell",
        PmBuyOrderId: "missing",
        Status: "None",
        BetMoney: 50,
        Money: 0,
        CreateAt: 300,
      },
      {
        OrderID: "pf-buy",
        Type: "PredictFun",
        Link: 1,
        PfSide: "buy",
        PfSellState: "closed",
        Status: "None",
        BetMoney: 10,
        Money: 1,
        CreateAt: 400,
      },
      {
        OrderID: "pf-sell",
        Type: "PredictFun",
        Link: 1,
        PfSide: "sell",
        PfBuyOrderId: "pf-buy",
        Status: "None",
        BetMoney: 11,
        Money: 0,
        CreateAt: 500,
      },
    ]);
    expect(blocks.map(b => ({ id: b.row.OrderID, attach: b.attach }))).toEqual([
      { id: "ob1", attach: false },
      { id: "buy", attach: false },
      { id: "sell", attach: true },
      { id: "orphan-sell", attach: false },
      { id: "pf-buy", attach: false },
      { id: "pf-sell", attach: true },
    ]);
    expect(blocks.find(b => b.row.OrderID === "sell")?.sellSource).toBe("row");
    expect(blocks.find(b => b.row.OrderID === "pf-sell")?.sellSource).toBe("row");
    // 组盈亏仍按全量 rows 计算，与 blocks 展示无关
    expect(computeOrderGroupProfit([
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 20, Status: "None" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 0, BetMoney: 120, PmBuyOrderId: "buy" },
    ])).toBe(20);
  });

  it("orderListDisplayBlocks prefers positionEvents over sell rows", () => {
    const blocks = orderListDisplayBlocks([
      {
        OrderID: "buy",
        Type: "Polymarket",
        Link: 1,
        PmSide: "buy",
        Match: "A vs B",
        Status: "None",
        BetMoney: 100,
        Money: 20,
        CreateAt: 100,
        PositionEvents: {
          sells: [{ id: "sell", at: 200, shares: 10, price: 0.6, proceeds: 6 }],
        },
      },
      {
        OrderID: "sell",
        Type: "Polymarket",
        Link: 1,
        PmSide: "sell",
        PmBuyOrderId: "buy",
        Status: "None",
        BetMoney: 41,
        PmShares: 9,
        CreateAt: 200,
      },
      {
        OrderID: "sell-only-row",
        Type: "Polymarket",
        Link: 1,
        PmSide: "sell",
        PmBuyOrderId: "buy",
        Status: "None",
        BetMoney: 5,
        CreateAt: 300,
      },
    ]);
    expect(blocks.map(b => ({
      id: b.row.OrderID,
      attach: b.attach,
      source: b.sellSource,
    }))).toEqual([
      { id: "buy", attach: false, source: undefined },
      { id: "sell", attach: true, source: "event" },
      { id: "sell-only-row", attach: true, source: "row" },
    ]);
    const fromEvent = blocks.find(b => b.row.OrderID === "sell");
    expect(fromEvent?.row.PmShares).toBe(10);
    expect(fromEvent?.row.PmFillPrice).toBe(0.6);
    expect(fromEvent?.row.PmStakeUsdc).toBe(6);
    // Phase 1：事件 proceeds 优先于影子卖单 BetMoney
    expect(fromEvent?.row.BetMoney).toBe(Math.round(6 * getExchange(Currency.USDT)));
  });

  it("orderListDisplayBlocks PF prefers positionEvents proceeds over sell BetMoney", () => {
    const blocks = orderListDisplayBlocks([
      {
        OrderID: "pf-buy",
        Type: "PredictFun",
        Link: 1,
        PfSide: "buy",
        Match: "PF A",
        Status: "None",
        BetMoney: 10,
        Money: 1,
        CreateAt: 100,
        PositionEvents: {
          sells: [{ id: "pf-sell", at: 200, shares: 8, price: 0.55, proceeds: 4.2 }],
        },
      },
      {
        OrderID: "pf-sell",
        Type: "PredictFun",
        Link: 1,
        PfSide: "sell",
        PfBuyOrderId: "pf-buy",
        Status: "None",
        BetMoney: 9.9,
        CreateAt: 200,
      },
    ]);
    const fromEvent = blocks.find(b => b.row.OrderID === "pf-sell");
    expect(fromEvent?.sellSource).toBe("event");
    expect(fromEvent?.attach).toBe(true);
    expect(fromEvent?.row.BetMoney).toBe(4.2);
    expect(fromEvent?.row.PfSellProceeds).toBe(4.2);
    expect(fromEvent?.row.PfShares).toBe(8);
  });

  it("orderListDisplayBlocks synthesizes attach from events when sell row missing", () => {
    const blocks = orderListDisplayBlocks([
      {
        OrderID: "buy",
        Type: "Polymarket",
        Link: 1,
        PmSide: "buy",
        Match: "Team A",
        Status: "None",
        CreateAt: 100,
        PositionEvents: {
          sells: [{ id: "ev-only", at: 150, shares: 3, price: 0.4, proceeds: 1.2 }],
        },
      },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      attach: true,
      sellSource: "event",
      row: {
        OrderID: "ev-only",
        PmSide: "sell",
        PmBuyOrderId: "buy",
        PmShares: 3,
        Match: "Team A",
      },
    });
  });

  it("orderLinkLegend uses buy Money only (sell Money ignored)", () => {
    const text = orderLinkLegend([
      {
        OrderID: "0xsell",
        Link: 1784400520115,
        Type: "Polymarket",
        PmSide: "sell",
        Status: "None",
        BetMoney: 115,
        Money: 3,
        Odds: 2.857,
        PmBuyOrderId: "0xbuy",
      },
      {
        OrderID: "ray",
        Link: 1784400520115,
        Type: "RAY",
        Status: "Reject",
        BetMoney: 200,
        Money: 0,
        Odds: 1.64,
      },
      {
        OrderID: "0xbuy",
        Link: 1784400520115,
        Type: "Polymarket",
        PmSide: "buy",
        Status: "None",
        BetMoney: 112,
        Money: 3,
        Odds: 2.941,
        PmShares: 48.2353,
        PmAttributedSellShares: 48.23,
        PmSellState: "partial",
        PmStakeUsdc: 0,
      },
    ]);
    expect(text).toBe("+3");
  });

  it("dropOrphanPolymarketSellGroups hides sell-only link groups", () => {
    const grouped = groupOrdersByLink([
      { OrderID: "s1", Link: 100, Type: "Polymarket", PmSide: "sell" as const },
      { OrderID: "b1", Link: 200, Type: "Polymarket", PmSide: "buy" as const },
      { OrderID: "s2", Link: 200, Type: "Polymarket", PmSide: "sell" as const, PmBuyOrderId: "b1" },
      { OrderID: "ob", Link: 300, Type: "OB" },
    ]);
    const filtered = dropOrphanPolymarketSellGroups(grouped);
    expect([...filtered.keys()].sort()).toEqual([200, 300]);
    expect(filtered.get(100)).toBeUndefined();
    expect(filtered.get(200)?.map(r => r.OrderID)).toEqual(["b1", "s2"]);
  });

  it("alignPredictionSellLinksToBuys remaps sell Link to parent buy", () => {
    const rows = alignPredictionSellLinksToBuys([
      {
        OrderID: "0xbuy",
        Link: 200,
        Type: "Polymarket",
        PmSide: "buy" as const,
        PmSellState: "closed" as const,
      },
      {
        OrderID: "0xsell",
        Link: 100,
        Type: "Polymarket",
        PmSide: "sell" as const,
        PmBuyOrderId: "0xBUY",
        Money: 0,
        BetMoney: 50,
      },
      {
        OrderID: "orphan",
        Link: 50,
        Type: "Polymarket",
        PmSide: "sell" as const,
        PmBuyOrderId: "missing",
      },
    ]);
    expect(effectiveOrderLink(rows[1]!, rows)).toBe(200);
    expect(rows[1]!.Link).toBe(200);
    expect(rows[2]!.Link).toBe(50);
  });

  it("groupOrdersByEffectiveLink nests mismatched-link sell under buy", () => {
    const grouped = dropOrphanPolymarketSellGroups(groupOrdersByEffectiveLink([
      {
        OrderID: "0xbuy",
        Link: 200,
        Type: "Polymarket",
        PmSide: "buy" as const,
        PmSellState: "closed" as const,
        Money: 10,
        CreateAt: 100,
      },
      {
        OrderID: "0xsell",
        Link: 100,
        Type: "Polymarket",
        PmSide: "sell" as const,
        PmBuyOrderId: "0xbuy",
        Money: 0,
        BetMoney: 80,
        CreateAt: 200,
      },
    ]));
    expect([...grouped.keys()]).toEqual([200]);
    const blocks = orderListDisplayBlocks(grouped.get(200)!);
    expect(blocks.map(b => ({ id: b.row.OrderID, attach: b.attach }))).toEqual([
      { id: "0xbuy", attach: false },
      { id: "0xsell", attach: true },
    ]);
  });

  it("isRebindableOrderRow rejects PM/PF sells", () => {
    expect(isRebindableOrderRow({
      OrderID: "0xsell",
      Link: 200,
      Type: "Polymarket",
      PmSide: "sell",
    })).toBe(false);
    expect(isRebindableOrderRow({
      OrderID: "0xbuy",
      Link: 200,
      Type: "Polymarket",
      PmSide: "buy",
    })).toBe(true);
  });

  it.each(["Polymarket", "PredictFun", "RAY", "OB"])("only a display-only row loses rebind eligibility; ordinary %s rows retain it", (Type) => {
    const row = { OrderID: "accepted-original", Link: 200, Type };
    expect(isRebindableOrderRow(row)).toBe(true);
    expect(isRebindableOrderRow({ ...row, DisplayOnly: undefined })).toBe(true);
    expect(isRebindableOrderRow({ ...row, DisplayOnly: true })).toBe(false);
    expect(isRebindableOrderRow({ ...row, Link: 0 })).toBe(false);
    expect(isRebindableOrderRow({ ...row, OrderID: "" })).toBe(false);
  });

  it("PM sell belongs to buy day for display and day profit", () => {
    const buyAt = Date.parse("2026-07-18T15:36:00+08:00");
    const sellAt = Date.parse("2026-07-19T00:24:00+08:00");
    const buyDay = toOrderDateKeyLocal(buyAt);
    const sellDay = toOrderDateKeyLocal(sellAt);
    const rows = [
      {
        OrderID: "0xbuy",
        Link: 99,
        Type: "Polymarket",
        PmSide: "buy" as const,
        CreateAt: buyAt,
        Money: 0,
        PmSellState: "closed" as const,
      },
      {
        OrderID: "0xsell",
        Link: 99,
        Type: "Polymarket",
        PmSide: "sell" as const,
        CreateAt: sellAt,
        Money: 12,
        PmBuyOrderId: "0xbuy",
      },
    ];
    expect(orderProfitDateTs(rows[1]!, rows)).toBe(buyAt);
    expect(filterOrdersBelongingToDate(rows, buyDay).map(r => r.OrderID).sort())
      .toEqual(["0xbuy", "0xsell"]);
    expect(filterOrdersBelongingToDate(rows, sellDay)).toEqual([]);
  });

  it("filterOrdersBelongingToDate books cross-day arb on Link bind day only", () => {
    const yday = Date.parse("2026-07-18T12:00:00+08:00");
    const today = Date.parse("2026-07-19T12:00:00+08:00");
    const ydayKey = toOrderDateKeyLocal(yday);
    const todayKey = toOrderDateKeyLocal(today);
    const rows = [
      { OrderID: "ob", Link: 7, Type: "OB", CreateAt: yday, Money: 5 },
      { OrderID: "pm", Link: 7, Type: "Polymarket", PmSide: "buy" as const, CreateAt: today, Money: 321 },
    ];
    expect(orderGroupHomeTs(rows)).toBe(yday);
    expect(orderProfitDateTs(rows[1]!, rows)).toBe(yday);
    expect(filterOrdersBelongingToDate(rows, ydayKey).map(r => r.OrderID).sort())
      .toEqual(["ob", "pm"]);
    expect(filterOrdersBelongingToDate(rows, todayKey)).toEqual([]);
  });

  it("midnight makeup arb stays on the Link bind day even without the first leg", () => {
    const link = 1_788_536_773_449;
    const pmAt = Date.parse("2026-09-05T00:08:27+08:00");
    const pmOnly = [{
      OrderID: "pm",
      Link: link,
      Type: "Polymarket",
      PmSide: "buy" as const,
      CreateAt: pmAt,
      Money: 321,
    }];
    expect(orderGroupHomeTs(pmOnly)).toBe(link);
    expect(filterOrdersBelongingToDate(pmOnly, "2026-09-04").map(r => r.OrderID))
      .toEqual(["pm"]);
    expect(filterOrdersBelongingToDate(pmOnly, "2026-09-05")).toEqual([]);
  });

  it("computeOrderGroupProfit includes buy Money on partial close (new model)", () => {
    const profit = computeOrderGroupProfit([
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 8, Status: "None", PmSellState: "partial" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 0, BetMoney: 40, PmBuyOrderId: "buy" },
    ]);
    expect(profit).toBe(8);
  });

  it("computeOrderGroupProfit ignores sell Money on partial close (PnL on buy only)", () => {
    const profit = computeOrderGroupProfit([
      { OrderID: "buy", Type: "Polymarket", PmSide: "buy", Money: 0, Status: "None", PmSellState: "partial" },
      { OrderID: "sell", Type: "Polymarket", PmSide: "sell", Money: 8, BetMoney: 40, PmBuyOrderId: "buy" },
    ]);
    expect(profit).toBe(0);
  });

  it("isLinkedArbOrderGroup detects cross-platform arb legs on same Link", () => {
    expect(
      isLinkedArbOrderGroup([
        { Link: 123, OrderID: "a", Type: "OB" },
        { Link: 123, OrderID: "b", Type: "Polymarket" },
      ]),
    ).toBe(true);
    expect(
      isLinkedArbOrderGroup([
        { Link: 123, OrderID: "a", Type: "Polymarket", PmSide: "buy" },
        { Link: 123, OrderID: "b", Type: "Polymarket", PmSide: "sell" },
      ]),
    ).toBe(false);
    expect(isLinkedArbOrderGroup([{ Link: -123, OrderID: "a" }])).toBe(false);
  });

  it("orderListDisplayRows keeps PM sell rows with buys and trad legs", () => {
    const rows = [
      { OrderID: "ob", Type: "OB", PmSide: undefined },
      { OrderID: "0xbuy", Type: "Polymarket", PmSide: "buy" as const },
      { OrderID: "0xsell", Type: "Polymarket", PmSide: "sell" as const, PmBuyOrderId: "0xbuy" },
    ];
    expect(orderListDisplayRows(rows).map(r => r.OrderID)).toEqual(["ob", "0xbuy", "0xsell"]);
  });

  it("mergePendingMakeupIntoOrderGroups folds lose queue into arb link", () => {
    const link = 1_700_000_000_999;
    const groups = groupOrdersByLink([
      { OrderID: "pm-1", Link: link, Type: "Polymarket", Status: "None", BetMoney: 100, Odds: 2.6 },
    ]);
    const loseOrders = new Map([
      [
        42,
        new LoseOrder({
          betId: 42,
          linkId: link,
          target: "Away",
          betMoney: 90,
          betOdds: 2.956,
          match: "G2 vs T1",
          bet: "[地图4] 获胜",
          accountId: 1,
          matchId: 1,
        }),
      ],
    ]);
    const merged = mergePendingMakeupIntoOrderGroups(groups, loseOrders, 1.01);
    expect(merged.get(link)?.map(r => r.OrderID)).toEqual(["pm-1", "makeup-42"]);
    expect(orderLinkLegend(merged.get(link)!)).toContain("补单中");
  });

  it("pending rows carry break-even and live band preferences without changing stored orders", () => {
    const order = new LoseOrder({ betId: 42, linkId: 1, betMoney: 100, betOdds: 2 });
    const prefs = { enabled: true, upper: 1.02, lower: 0.96 };
    const row = loseOrderToPendingRow(order, 1.01, prefs);
    expect(row.Odds).toBe(2);
    expect(row.MakeupOddsBand).toEqual({
      breakEvenOdds: 2, lowerOdds: 1.92, upperOdds: 2.04, approximate: false,
    });
    expect(loseOrderToPendingRow(order, 1.01, { ...prefs, upper: 1.05 }).MakeupOddsBand?.upperOdds).toBe(2.1);
    expect(loseOrderToPendingRow(order, 1.01).MakeupOddsBand).toBeUndefined();
    expect(loseOrderToPendingRow(order, 1.01).Odds).toBe(order.getOdds(1.01));
    expect(order.betOdds).toBe(2);
  });

  it("loseOrderToPendingRow reflects runtime placing phase", () => {
    const row = loseOrderToPendingRow(
      new LoseOrder({
        betId: 42,
        linkId: 1,
        target: "Away",
        betMoney: 90,
        betOdds: 2.9,
        match: "G2 vs T1",
        bet: "map",
        accountId: 1,
        matchId: 1,
        runtimePhase: "placing",
      }),
      1.01,
    );
    expect(row.Status).toBe("MakeupPlacing");
    expect(makeupPendingProfitLabel(row)).toBe("下单中");
  });

  it("mergePendingMakeupIntoOrderGroups does not fold cancelled makeup into arb link", () => {
    const link = 1_700_000_000_999;
    const groups = groupOrdersByLink([
      { OrderID: "pm-1", Link: link, Type: "Polymarket", Status: "None", BetMoney: 100, Odds: 2.6 },
    ]);
    const cancelled = new Map([
      [
        42,
        {
          betId: 42,
          linkId: link,
          target: "Away" as const,
          match: "G2 vs T1",
          bet: "[地图4] 获胜",
          createAt: 1,
          cancelledAt: 2,
        },
      ],
    ]);
    const merged = mergePendingMakeupIntoOrderGroups(groups, new Map(), 1.01, cancelled);
    expect(merged.get(link)?.map(r => r.OrderID)).toEqual(["pm-1"]);
  });

  it("canRebindOrderLinkTo only allows newer link onto older link", () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    expect(canRebindOrderLinkTo(newer, older)).toBe(true);
    expect(canRebindOrderLinkTo(older, newer)).toBe(false);
    expect(canRebindOrderLinkTo(newer, newer)).toBe(false);
  });

  it("isSameOrderMatchMap requires same match and map slot", () => {
    expect(isSameOrderMatchMap(
      { Match: "A vs B", Bet: "[地图2] 获胜" },
      { Match: "B vs A", Bet: "[地图2] 让分" },
    )).toBe(true);
    expect(isSameOrderMatchMap(
      { Match: "A vs B", Bet: "[地图2] 获胜" },
      { Match: "A vs B", Bet: "[地图1] 获胜" },
    )).toBe(false);
    expect(isSameOrderMatchMap(
      { Match: "A vs B", Bet: "[地图2] 获胜" },
      { Match: "C vs D", Bet: "[地图2] 获胜" },
    )).toBe(false);
    expect(isSameOrderMatchMap(
      { Match: "A vs B", Bet: "未知盘口" },
      { Match: "A vs B", Bet: "未知盘口" },
    )).toBe(false);
  });

  it("isSameOrderMatchMap tolerates PM LoL/Game suffix vs venue title", () => {
    expect(isSameOrderMatchMap(
      {
        Match: "LoL: Team Secret vs Karmine Corp - Game 2 Winner",
        Bet: "地图2",
      },
      {
        Match: "Team Secret vs Karmine Corp",
        Bet: "[地图2]单局 - 获胜",
      },
    )).toBe(true);
  });

  it("canRebindOrderOnto only checks newer→older link", () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    expect(canRebindOrderOnto(
      { Link: newer },
      { Link: older },
    )).toBe(true);
    expect(canRebindOrderOnto(
      { Link: newer },
      { Link: older },
    )).toBe(true);
    expect(canRebindOrderOnto(
      { Link: older },
      { Link: newer },
    )).toBe(false);
  });

  it("isRebindableOrderRow excludes makeup synthetics", () => {
    expect(isRebindableOrderRow({
      OrderID: "real-1",
      Link: 1_700_000_000_100,
      Type: "OB",
      Status: "Win",
    } as any)).toBe(true);
    expect(isRebindableOrderRow({
      OrderID: "makeup-42",
      Link: 1_700_000_000_100,
      Status: "Makeup",
    } as any)).toBe(false);
  });

  it("countPrimaryOrderRows excludes PM/PF sells", () => {
    expect(countPrimaryOrderRows([
      { OrderID: "ob", Type: "OB", Link: 1 },
      { OrderID: "buy", Type: "Polymarket", Link: 1, PmSide: "buy" },
      { OrderID: "sell", Type: "Polymarket", Link: 1, PmSide: "sell", PmBuyOrderId: "buy" },
      { OrderID: "pf-sell", Type: "PredictFun", Link: 2, PfSide: "sell" },
      { OrderID: "pf-buy", Type: "PredictFun", Link: 2, PfSide: "buy" },
    ] as any)).toBe(3);
  });
});
