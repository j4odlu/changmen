import { beforeEach, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ViewBetItem } from "@/models/match";
import { useOddsStore } from "@/stores/oddsStore";
beforeEach(() => setActivePinia(createPinia()));

it.each(["OB", "RAY"] as const)("%s matcher locked projection uses the unchanged A8 read path without referencing old live quotes", provider => {
  const store = useOddsStore();
  const source = { Type: provider, BetID: "bet", HomeID: "", AwayID: "",
    HomeOdds: 0, AwayOdds: 0, Status: "Locked" };
  const item = new ViewBetItem(source, "match");
  for (const price of [1.9, 2.1]) {
    for (const id of ["h", "a"]) store.save(provider, { id, odds: price, isLock: false, time: Date.now() });
    expect(item.getOdds("Home")).toBe(0);
    expect(item.getOdds("Away")).toBe(0);
    item.updateOdds();
    expect(item.fallbackHomeOdds).toBe(0);
    expect(item.betId).toBe("bet");
  }
  const restored = new ViewBetItem({ ...source, HomeID: "h", AwayID: "a", Status: "Normal" }, "match");
  expect(restored.getOdds("Home")).toBe(2.1);
  // 普通盘口锁盘仍由实时行情决定，保持原行为。
  expect(new ViewBetItem({ ...source, HomeID: "h", AwayID: "a" }, "match").getOdds("Home")).toBe(2.1);
});
