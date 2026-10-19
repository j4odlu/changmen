import { describe, expect, it } from "vitest";
import { ViewBet } from "./match.js";

function bet(partial: Record<string, unknown>) {
  return new ViewBet(
    {
      ID: 1,
      MatchID: 1,
      Map: 0,
      Name: "",
      HomeID: 1,
      HomeName: "A",
      AwayID: 2,
      AwayName: "B",
      Sources: {},
      ...partial,
    } as never,
    {},
    0,
    0,
  );
}

describe("ViewBet.getBetName isolation", () => {
  it("esport Map=0 keeps 全场胜负 even when Name is platform raw text", () => {
    expect(bet({ Name: "[全场]-全局-获胜" }).getBetName()).toBe("全场胜负");
    expect(bet({ Name: "[全场] 获胜者" }).getBetName()).toBe("全场胜负");
    expect(bet({ Name: "Match Winner" }).getBetName()).toBe("全场胜负");
    expect(bet({ Map: 2, Name: "whatever" }).getBetName()).toBe("[地图2] 获胜");
  });

  it("sport MarketCode uses Name / line labels", () => {
    expect(bet({ MarketCode: "moneyline", Name: "全场胜负" }).getBetName()).toBe("全场胜负");
    expect(bet({ MarketCode: "spreads", Name: "让球 -1.5", Line: -1.5 }).getBetName()).toBe("让球 -1.5");
    expect(bet({ MarketCode: "totals", Name: "大小 2.5", Line: 2.5 }).getBetName()).toBe("大小 2.5");
  });
});
