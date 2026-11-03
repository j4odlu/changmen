import { describe, expect, it } from "vitest";
import { captureOrderMarketIdentity, mergeOrderMarketIdentity, normalizeOrderMarketIdentity } from "./order_market_identity";

const snapshot = { matchId: 17, betId: 22, round: 3, game: "CS2", matchTitle: "A vs B", betName: "[地图3] 获胜" };

describe("order market identity", () => {
  it("copies selection facts without retaining live objects or native-market labels", () => {
    const match = { id: 17, game: "CS2", title: "A vs B" };
    const bet = { id: 22, round: 3, getBetName: () => "[地图3] 获胜" };
    const captured = captureOrderMarketIdentity(match, bet);
    match.title = "changed"; bet.round = 1;
    expect(captured).toEqual(snapshot);
  });
  it.each([0, -1, 2])("preserves explicit round %s, including full match and special markets", (round) => {
    expect(normalizeOrderMarketIdentity({ ...snapshot, round })?.round).toBe(round);
  });
  it.each([undefined, {}, { ...snapshot, round: undefined }, { ...snapshot, matchId: "17" },
    { ...snapshot, betId: 0 }, { ...snapshot, round: -2 }, { ...snapshot, round: 1.5 }])("keeps missing or invalid identities unknown", (raw) => {
    expect(normalizeOrderMarketIdentity(raw)).toBeUndefined();
  });
  it("whitelists metadata and preserves the first snapshot on omitted or conflicting syncs", () => {
    expect(normalizeOrderMarketIdentity({ ...snapshot, token: "credential", line: 0, marketCode: "moneyline" }))
      .toEqual({ ...snapshot, line: 0, marketCode: "moneyline" });
    expect(mergeOrderMarketIdentity(snapshot, undefined)).toEqual(snapshot);
    expect(mergeOrderMarketIdentity(snapshot, { ...snapshot, round: 1 })).toEqual(snapshot);
    expect(mergeOrderMarketIdentity(undefined, snapshot)).toEqual(snapshot);
  });
  it("does not interrupt a legacy caller without a full composed market model", () => {
    expect(captureOrderMarketIdentity({ id: 17, game: "CS2", title: "A vs B" },
      { id: 22, round: 3 } as Parameters<typeof captureOrderMarketIdentity>[1])).toBeUndefined();
  });
});
