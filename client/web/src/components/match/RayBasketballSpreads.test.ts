import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { ViewMatch } from "@changmen/client-core/models/match";
import { ingestRayBasketballSpreads, clearRayBasketballSpreads } from "@changmen/venue-browser/adapter/ray/markets";
import { handleRayRealtimeMessage } from "@changmen/venue-browser/adapter/ray/collect";
import { useOddsStore } from "@/stores/oddsStore";
import MatchCard from "./MatchCard.vue";

vi.mock("./BetRow.vue", () => ({ default: { props: ["bet"], template: '<div class="legacy-winner">原全场胜负 {{ bet.id }}</div>' } }));
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: { template: '<span>RAY</span>' } }));

let pinia: Pinia;
beforeEach(() => { pinia = createPinia(); setActivePinia(pinia); clearRayBasketballSpreads(); });
afterEach(clearRayBasketballSpreads);
function match(game = "篮球", withRay = true, reversed = false) {
  return new ViewMatch({ ID: 100, Title: "统一主队 vs 统一客队", Game: game, GameID: 10001, StartTime: 1,
    Reverse: reversed ? ["RAY"] : [], Matchs: withRay ? { RAY: "ray-event", Polymarket: "pm-event" } : { Polymarket: "pm-event" }, Bets: [{
      ID: 200, MatchID: 100, Map: 0, Name: "[全场] 获胜者", HomeID: 1, AwayID: 2, HomeName: "统一主队", AwayName: "统一客队",
      Sources: { RAY: { Type: "RAY", BetID: "1279801", HomeID: "win-h", AwayID: "win-a", HomeOdds: 1.8, AwayOdds: 2, Status: "Normal" } },
    }] });
}
function seed() {
  ingestRayBasketballSpreads("ray-event", { id: "ray-event", team: [{ pos: 1, team_id: 10 }, { pos: 2, team_id: 20 }], odds: [
    { odds_id: "h45", odds_group_id: 1279840, match_stage: "final", tag: "hdp", value: "-4.5", team_id: 10, status: 1, odds: 1.95 },
    { odds_id: "a45", odds_group_id: 1279840, match_stage: "final", tag: "hdp", value: "+4.5", team_id: 20, status: 2, odds: 1.9 },
  ] }, "basketball");
}
const render = (value: ViewMatch) => renderToString(createSSRApp(MatchCard, { match: value }).use(pinia));

it("inserts a display-only spread after the original winner without changing its bets, and follows actual WS prices and locks", async () => {
  const value = match(); const originalBets = [...value.bets]; seed();
  const html = await render(value);
  expect(html.indexOf("原全场胜负 200")).toBeLessThan(html.indexOf("RAY 篮球全场让分"));
  expect(html).toContain("-4.5"); expect(html).toContain("+4.5");
  expect(html).toContain("1.95"); expect(html).toContain("锁盘");
  expect(html).not.toContain("1.9</span>");
  handleRayRealtimeMessage({ source: "odds", odds: [{ id: "a45", odds: 2.14, status: 1 }] });
  expect(await render(value)).toContain("2.14");
  useOddsStore().clean("RAY");
  expect(await render(value)).toContain("等待报价");
  expect(value.bets).toEqual(originalBets);
});

it("orders native selections by the server's RAY direction with their own signed lines and canonical team names", async () => {
  seed(); const html = await render(match("basketball", true, true));
  const home = html.match(/<div\b[^>]*class="[^"]*\bhome\b[^"]*"[^>]*>[\s\S]*?<\/div>/)?.[0];
  expect(home).toContain('data-ray-spread-odd-id="a45"');
  expect(home).toContain("+4.5"); expect(home).toContain("统一主队");
  const away = html.match(/<div\b[^>]*class="[^"]*\baway\b[^"]*"[^>]*>[\s\S]*?<\/div>/)?.[0];
  expect(away).toContain('data-ray-spread-odd-id="h45"'); expect(away).toContain("-4.5");
});

it("does not create a category or empty market card when no concrete line exists, and leaves other matches unchanged", async () => {
  expect(await render(match())).not.toContain("ray-basketball-spread");
  ingestRayBasketballSpreads("ray-event", { id: "ray-event", team: [{ pos: 1, team_id: 10 }, { pos: 2, team_id: 20 }], odds: [] }, "basketball");
  expect(await render(match())).not.toContain("ray-basketball-spread");
  for (const value of [match("cs2"), match("basketball", false)]) {
    const html = await render(value);
    expect(html).toContain("原全场胜负 200");
    expect(html).not.toContain("ray-basketball-spread");
  }
});

it("renders exactly one card per concrete spread line with its own title, selection IDs and prices", async () => {
  ingestRayBasketballSpreads("ray-event", { id: "ray-event", team: [{ pos: 1, team_id: 10 }, { pos: 2, team_id: 20 }], odds: [
    ...[4.5, 5.5, 6.5].flatMap((line, index) => [
      { odds_id: `h${index}`, odds_group_id: 1279840, match_stage: "final", tag: "hdp", value: `-${line}`, team_id: 10, status: 1, odds: (191 + index) / 100 },
      { odds_id: `a${index}`, odds_group_id: 1279840, match_stage: "final", tag: "hdp", value: `+${line}`, team_id: 20, status: 1, odds: (201 + index) / 100 },
    ]),
  ] }, "basketball");
  const value = match(); const html = await render(value);
  const cards = [...html.matchAll(/<section\b[^>]*class="bet ray-basketball-spread"[^>]*>[\s\S]*?<\/section>/g)].map(result => result[0]);
  expect(cards).toHaveLength(3);
  for (const [index, line] of [4.5, 5.5, 6.5].entries()) {
    const card = cards.find(card => card.includes(`主 -${line} / 客 +${line}`));
    expect(card).toBeDefined();
    expect(card).toContain(`[全场] 让分（主 -${line} / 客 +${line}，含加时）`);
    expect(card).toContain(`data-ray-spread-odd-id="h${index}"`);
    expect(card).toContain(`data-ray-spread-odd-id="a${index}"`);
    expect(card).toContain(String((191 + index) / 100));
    expect(card).toContain(String((201 + index) / 100));
    for (const other of [0, 1, 2].filter(other => other !== index))
      expect(card).not.toContain(`data-ray-spread-odd-id="h${other}"`);
  }
  expect(value.bets).toHaveLength(1);
  expect(html.indexOf("原全场胜负 200")).toBeLessThan(html.indexOf('<section'));
});
