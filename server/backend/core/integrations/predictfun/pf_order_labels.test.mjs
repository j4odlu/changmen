import { describe, expect, it, vi } from "vitest";

vi.mock("@changmen/storage/predictfun_market_index", () => ({
  readPredictFunMarketIndex: () => ({
    updatedAt: 1,
    marketIds: ["844582"],
    entries: [{
      sourceMatchId: "1",
      categoryId: "c",
      homeMarketId: "844582",
      awayMarketId: "844582",
      homeTokenId: "tok-home",
      awayTokenId: "tok-away",
      sourceBetId: "b",
      map: 0,
      homeName: "Kits",
      awayName: "SDM",
      homeOdds: 1.6,
      awayOdds: 2,
      status: "Open",
    }],
  }),
}));

const {
  isBarePfMatchLabel,
  resolvePfOrderLabels,
  pfSellItemLabel,
} = await import("./pf_order_labels.js");

describe("pf_order_labels", () => {
  it("detects bare market id", () => {
    expect(isBarePfMatchLabel("844582")).toBe(true);
    expect(isBarePfMatchLabel("Kits vs SDM")).toBe(false);
  });

  it("treats 市场 N as bare and upgrades from index", () => {
    const labels = resolvePfOrderLabels({
      marketId: "844582",
      tokenId: "tok-home",
      match: "市场 844582",
      bet: "全场胜负",
      item: "tok-home",
    });
    expect(labels.match).toBe("Kits vs SDM");
    expect(labels.item).toBe("Kits");
  });

  it("resolves from index when match/item bare", () => {
    const labels = resolvePfOrderLabels({
      marketId: "844582",
      tokenId: "tok-home",
      match: "844582",
      bet: "PredictFun",
      item: "tok-home",
    });
    expect(labels.match).toBe("Kits vs SDM");
    expect(labels.bet).toBe("全场胜负");
    expect(labels.item).toBe("Kits");
  });

  it("prefers client display fields", () => {
    const labels = resolvePfOrderLabels({
      marketId: "844582",
      tokenId: "tok-away",
      fromClient: {
        match: "A vs B",
        bet: "全场胜负",
        item: "B",
      },
    });
    expect(labels).toEqual({ match: "A vs B", bet: "全场胜负", item: "B" });
  });

  it("sell item prefixes 平仓", () => {
    expect(pfSellItemLabel("Kits")).toBe("平仓 Kits");
    expect(pfSellItemLabel("平仓 Kits")).toBe("平仓 Kits");
  });
});
