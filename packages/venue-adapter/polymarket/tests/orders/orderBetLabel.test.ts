import type { PolymarketMarketIndexEntry } from "@changmen/api-contract";
import type { VenueOrder } from "../../../contract";
import { describe, expect, it } from "vitest";
import { lookupPolymarketOrderBetLabel, rememberPolymarketIndexBetLabel, rememberPolymarketMarketBetLabel } from "../../markets/orderBetLabel";
import { finalizePolymarketVenueOrders } from "../../orders";

describe("PM orders use native market labels instead of composer periods", () => {
  it("keeps a full-match token labelled full match after decider projection", () => {
    rememberPolymarketIndexBetLabel({ marketId: "label-full", homeTokenId: "label-home", awayTokenId: "label-away", map: 0 } as PolymarketMarketIndexEntry);
    expect(lookupPolymarketOrderBetLabel("label-full", "label-home")).toBe("全场");
    expect(lookupPolymarketOrderBetLabel("other-condition", "label-home")).toBe("");
    expect(lookupPolymarketOrderBetLabel("label-full", "other-token")).toBe("");
  });
  it("uses the official map number and supports CLOB-only historical metadata", () => {
    rememberPolymarketMarketBetLabel({ condition_id: "label-map", question: "Dota 2: A vs B - Game 2 Winner", tokens: [{ token_id: "map-token" }] });
    expect(lookupPolymarketOrderBetLabel("label-map", "map-token")).toBe("地图2");
    rememberPolymarketMarketBetLabel({ condition_id: "label-clob-full", question: "Dota 2: Inner Circle vs Team Lynx (BO3) - EPL Masters Play-In Group A", tokens: [{ token_id: "full-token" }] });
    expect(lookupPolymarketOrderBetLabel("label-clob-full", "full-token")).toBe("全场");
  });
  it("does not interpret unrecognised markets or a missing index map as full match", () => {
    rememberPolymarketMarketBetLabel({ condition_id: "label-unknown", question: "Dota 2: A vs B (BO3) - Total Maps", clobTokenIds: ["unknown-token"] });
    rememberPolymarketIndexBetLabel({ marketId: "label-missing", homeTokenId: "missing-token" } as PolymarketMarketIndexEntry);
    expect(lookupPolymarketOrderBetLabel("label-unknown", "unknown-token")).toBe("");
    expect(lookupPolymarketOrderBetLabel("label-missing", "missing-token")).toBe("");
  });
  it("corrects a saved GTC decider label even when no trade is in the incremental window", () => {
    rememberPolymarketMarketBetLabel({ conditionId: "label-stored", groupItemTitle: "Match Winner", clobTokenIds: ["stored-token"] });
    const stored = { provider: "Polymarket", orderId: "label-order", bet: "[地图3] 获胜", pmConditionId: "label-stored", pmTokenId: "stored-token", pmOrigin: "changmen", betMoney: 24, odds: 3.333, pmGtcExecutionId: "execution", link: 52 } as VenueOrder;
    const [out] = finalizePolymarketVenueOrders([], 292, [stored]);
    expect(out!.bet).toBe("全场");
    expect(stored.bet).toBe("[地图3] 获胜");
    expect(out).toMatchObject({ orderId: stored.orderId, pmTokenId: stored.pmTokenId, pmGtcExecutionId: "execution", link: 52, odds: 3.333 });
  });
  it("prefers freshly resolved official labels over a saved decider name", () => {
    const stored = { provider: "Polymarket", orderId: "label-merged", bet: "[地图3] 获胜", pmOrigin: "changmen", betMoney: 24, odds: 3.333, pmShares: 11.33, pmStakeUsdc: 3.399, pmSide: "buy", status: "none" } as VenueOrder;
    const official = { ...stored, bet: "全场", betMoney: 3.399 };
    expect(finalizePolymarketVenueOrders([official], 292, [stored])[0]!.bet).toBe("全场");
  });
});
