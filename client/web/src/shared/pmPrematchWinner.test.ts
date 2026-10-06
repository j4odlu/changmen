import type { ViewBet, ViewMatch } from "@/models/match";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp } from "vue";
import { afterEach, expect, it } from "vitest";
import PmPrematchProbability from "@/components/match/PmPrematchProbability.vue";
import { replacePmMapOutcomesFromIndex } from "@changmen/venue-adapter/polymarket";

afterEach(() => replacePmMapOutcomesFromIndex(null));

it.each([false, true])("places WIN beside the C price for the winning token (reversed=%s)", async (reversed) => {
  replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["a", "b"], entries: [{
    sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1,
    homeTokenId: "a", awayTokenId: "b", homeName: "A", awayName: "B",
    homeOdds: 0, awayOdds: 0, status: "Lock", mapOutcome: "home", outcomeKind: "official",
  }] });
  const bet = { homeName: reversed ? "B" : "A", awayName: reversed ? "A" : "B",
    getBetName: () => "地图1", items: [{ type: "Polymarket", homeId: reversed ? "b" : "a", awayId: reversed ? "a" : "b" }],
  } as unknown as ViewBet;
  const snapshot = (tokenId: string, price: number) => ({ tokenId, marketId: "m", status: "ready" as const,
    registeredStart: 101000, cutoff: 100, checkedAt: 102000, nextCheckAt: 702000,
    observationTime: 100000, resolution: 0, price });
  const match = { pmPrematch: { a: snapshot("a", .4), b: snapshot("b", .6) } } as unknown as ViewMatch;
  const html = await renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
  expect(html).toContain('class="item flex pm-prematch"');
  expect(html.match(/class="pm-map-win-badge"/g)).toHaveLength(1);
  const winnerClass = html.match(/class="([^"]*pm-map-won[^"]*)"/)?.[1]?.split(/\s+/);
  expect(winnerClass).toEqual(expect.arrayContaining(["item-odds", reversed ? "away" : "home"]));
  expect(html).toContain('aria-label="A：40.0%，WIN"');
  expect(html).toContain("PM 官方胜负");
});

it("keeps the result visible without inventing a missing pregame price, and clears it when the index changes", async () => {
  const index = { updatedAt: 1, assetIds: ["a", "b"], entries: [{
    sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1,
    homeTokenId: "a", awayTokenId: "b", homeName: "A", awayName: "B",
    homeOdds: 0, awayOdds: 0, status: "Lock", mapOutcome: "away" as const, outcomeKind: "price" as const,
  }] };
  const bet = { homeName: "A", awayName: "B", getBetName: () => "地图1",
    items: [{ type: "Polymarket", homeId: "a", awayId: "b" }],
  } as unknown as ViewBet;
  const render = () => renderToString(createSSRApp(PmPrematchProbability, { bet, match: {} as ViewMatch }));
  replacePmMapOutcomesFromIndex(index);
  const html = await render();
  expect(html).toContain('aria-label="B：等待 VPS 历史价，WIN"');
  expect(html).toContain("PM 价格决出");
  expect(html).not.toContain("%");
  replacePmMapOutcomesFromIndex({ ...index, entries: [] });
  expect(await render()).not.toContain("pm-map-win-badge");
  replacePmMapOutcomesFromIndex(index);
  bet.items[0]!.homeId = "map2-home";
  bet.items[0]!.awayId = "map2-away";
  expect(await render()).not.toContain("pm-map-win-badge");
});
