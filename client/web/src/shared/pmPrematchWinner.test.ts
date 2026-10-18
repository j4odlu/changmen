import type { ViewBet, ViewMatch } from "@/models/match";
import { replacePmMapOutcomesFromIndex } from "@changmen/venue-adapter/polymarket";
import { renderToString } from "@vue/server-renderer";
import { afterEach, expect, it } from "vitest";
import { createSSRApp } from "vue";
import PmPrematchProbability from "@/components/match/PmPrematchProbability.vue";

afterEach(() => replacePmMapOutcomesFromIndex(null));

it.each([false, true])("shows a score-confirmed winner before settlement, and gives the official result priority (reversed snapshot=%s)", async (reversed) => {
  const bet = { round: 1, homeName: "Home", awayName: "Away", getBetName: () => "地图1",
    items: [{ type: "Polymarket", homeId: "a", awayId: "b" }] } as unknown as ViewBet;
  const match = { id: 1, reverse: reversed ? ["Polymarket"] : [],
    pmSport: { live: true, currentMap: 2, homeTeam: reversed ? "Away" : "Home", awayTeam: reversed ? "Home" : "Away",
      scoreRaw: "000-000|1-0|Bo3", mapScore: { home: 1, away: 0 } } } as unknown as ViewMatch;
  const render = () => renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
  const html = await render();
  expect(html).toContain("胜 · 待结算");
  expect(html).not.toContain(">WIN<");
  expect(html).toContain(`${reversed ? 'Away' : 'Home'}：等待 VPS 历史价，比分确认胜出，PM 待结算`);
  expect(html).toContain("比分确认胜出，等待 PM 官方结算");
  replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["a", "b"], entries: [{
    sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 1, homeTokenId: "a", awayTokenId: "b",
    homeName: "Home", awayName: "Away", homeOdds: 0, awayOdds: 0, status: "Locked", mapOutcome: reversed ? "home" : "away", outcomeKind: "official",
  }] });
  const official = await render();
  expect(official).toContain(">WIN<");
  expect(official).not.toContain("胜 · 待结算");
  expect(official).toContain("PM 官方胜负");
});

it("only marks played, finished maps as pending, and replaces pending with an official WIN", async () => {
  const bet = { round: 2, homeName: "A", awayName: "B", getBetName: () => "地图2",
    items: [{ type: "Polymarket", homeId: "a", awayId: "b" }] } as unknown as ViewBet;
  const match = { pmSport: { live: true, currentMap: 2 } } as unknown as ViewMatch;
  const render = () => renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
  expect(await render()).not.toContain("待结算");
  match.pmSport!.currentMap = 3;
  expect(await render()).toContain("待结算");
  bet.round = 3;
  expect(await render()).not.toContain("待结算");
  match.pmSport = { ended: true, mapScore: { home: 1, away: 2 } };
  expect(await render()).toContain("待结算");
  match.pmSport.mapScore = { home: 2, away: 0 };
  expect(await render()).not.toContain("待结算");
  match.pmSport = {};
  expect(await render()).not.toContain("待结算");
  match.pmSport = { ended: true, mapScore: { home: 1, away: 2 } };
  replacePmMapOutcomesFromIndex({ updatedAt: 1, entries: [], assetIds: [], outcomeEntries: [{
    firstSeenAt: 1, sourceMatchId: "e", marketId: "m", sourceBetId: "m", map: 0,
    homeTokenId: "a", awayTokenId: "b", homeName: "A", awayName: "B", homeOdds: 0,
    awayOdds: 0, status: "Locked", mapOutcome: "away", outcomeKind: "official",
  }] });
  const html = await render();
  expect(html).not.toContain("待结算");
  expect(html).toContain("pm-map-win-badge");
});

it.each([false, true])("puts each team's live score inside its own C cell (reversed=%s)", async (reversed) => {
  const bet = { round: 3, homeName: "Home", awayName: "Away", getBetName: () => "地图3",
    items: [{ type: "Polymarket", homeId: "a", awayId: "b" }] } as unknown as ViewBet;
  const point = (tokenId: string) => ({ tokenId, marketId: "m", status: "ready" as const,
    registeredStart: 101000, cutoff: 100, checkedAt: 102000, nextCheckAt: 702000,
    observationTime: 100000, resolution: 0, price: .5 });
  const match = { reverse: reversed ? ["Polymarket"] : [], pmPrematch: { a: point("a"), b: point("b") },
    pmSport: { live: true, currentMap: 3, scoreRaw: "11-8|1-1|Bo5" } } as unknown as ViewMatch;
  const render = () => renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
  const html = await render();
  expect(html).toContain(`aria-label="Home：局内比分${reversed ? 8 : 11}，赛前50.0%"`);
  expect(html).toContain(`aria-label="Away：局内比分${reversed ? 11 : 8}，赛前50.0%"`);
  expect(html.match(/class="pm-round-score"/g)).toHaveLength(2);
  expect(html.match(/class="pm-round-probability"/g)).toHaveLength(2);
  bet.round = 2;
  expect(await render()).not.toContain('class="pm-round-score"');
  bet.round = 3;
  match.pmSport!.ended = true;
  expect(await render()).not.toContain('class="pm-round-score"');
});

it.each([false, true])("places WIN beside the C price for the winning token (reversed=%s)", async (reversed) => {
  replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["a", "b"], entries: [{
    sourceMatchId: "e",
    marketId: "m",
    sourceBetId: "m",
    map: 1,
    homeTokenId: "a",
    awayTokenId: "b",
    homeName: "A",
    awayName: "B",
    homeOdds: 0,
    awayOdds: 0,
    status: "Lock",
    mapOutcome: "home",
    outcomeKind: "official",
  }] });
  const bet = { homeName: reversed ? "B" : "A", awayName: reversed ? "A" : "B", getBetName: () => "地图1", items: [{ type: "Polymarket", homeId: reversed ? "b" : "a", awayId: reversed ? "a" : "b" }] } as unknown as ViewBet;
  const snapshot = (tokenId: string, price: number) => ({ tokenId, marketId: "m", status: "ready" as const, registeredStart: 101000, cutoff: 100, checkedAt: 102000, nextCheckAt: 702000, observationTime: 100000, resolution: 0, price });
  const match = { pmPrematch: { a: snapshot("a", 0.4), b: snapshot("b", 0.6) } } as unknown as ViewMatch;
  const html = await renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
  expect(html).toContain("class=\"item flex pm-prematch\"");
  expect(html.match(/class="pm-map-win-badge"/g)).toHaveLength(1);
  const winnerClass = html.match(/class="([^"]*pm-map-won[^"]*)"/)?.[1]?.split(/\s+/);
  expect(winnerClass).toEqual(expect.arrayContaining(["item-odds", reversed ? "away" : "home"]));
  expect(html).toContain("aria-label=\"A：40.0%，WIN\"");
  expect(html).toContain("PM 官方胜负");
});

it("keeps the result visible without inventing a missing pregame price, and clears it when the index changes", async () => {
  const index = { updatedAt: 1, assetIds: ["a", "b"], entries: [{
    sourceMatchId: "e",
    marketId: "m",
    sourceBetId: "m",
    map: 1,
    homeTokenId: "a",
    awayTokenId: "b",
    homeName: "A",
    awayName: "B",
    homeOdds: 0,
    awayOdds: 0,
    status: "Lock",
    mapOutcome: "away" as const,
    outcomeKind: "official" as const,
  }] };
  const bet = { homeName: "A", awayName: "B", getBetName: () => "地图1", items: [{ type: "Polymarket", homeId: "a", awayId: "b" }] } as unknown as ViewBet;
  const render = () => renderToString(createSSRApp(PmPrematchProbability, { bet, match: {} as ViewMatch }));
  replacePmMapOutcomesFromIndex(index);
  const html = await render();
  expect(html).toContain("aria-label=\"B：等待 VPS 历史价，WIN\"");
  expect(html).toContain("PM 官方胜负");
  expect(html).not.toContain("%");
  replacePmMapOutcomesFromIndex({ ...index, entries: [] });
  expect(await render()).not.toContain("pm-map-win-badge");
  replacePmMapOutcomesFromIndex(index);
  bet.items[0]!.homeId = "map2-home";
  bet.items[0]!.awayId = "map2-away";
  expect(await render()).not.toContain("pm-map-win-badge");
});

it.each([0, 1, 3])("does not display WIN from legacy price outcomes or missing evidence (map=%s)", async (map) => {
  const bet = { homeName: "STATE", awayName: "Teletubisie", getBetName: () => `地图${map}`, items: [{ type: "Polymarket", homeId: "a", awayId: "b" }] } as unknown as ViewBet;
  const snapshot = (tokenId: string, price: number) => ({ tokenId, marketId: "m", status: "ready" as const, registeredStart: 101000, cutoff: 100, checkedAt: 102000, nextCheckAt: 702000, observationTime: 100000, resolution: 0, price });
  const match = { pmPrematch: { a: snapshot("a", 0.995), b: snapshot("b", 0.005) } } as unknown as ViewMatch;
  for (const outcomeKind of ["price", undefined] as const) {
    replacePmMapOutcomesFromIndex({ updatedAt: 1, assetIds: ["a", "b"], entries: [{
      sourceMatchId: "e",
      marketId: "m",
      sourceBetId: "m",
      map,
      homeTokenId: "a",
      awayTokenId: "b",
      homeName: "STATE",
      awayName: "Teletubisie",
      homeOdds: 1.001,
      awayOdds: 125,
      status: "Normal",
      mapOutcome: "home",
      outcomeKind,
    }] });
    const html = await renderToString(createSSRApp(PmPrematchProbability, { bet, match }));
    expect(html).toContain("99.5%");
    expect(html).not.toContain("WIN");
    expect(html).not.toContain("pm-map-win-badge");
    expect(html).not.toContain("pm-map-won");
  }
});
