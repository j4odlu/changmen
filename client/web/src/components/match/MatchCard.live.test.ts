import { expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { ViewMatch, type ViewBet } from "@changmen/client-core/models/match";
import MatchCard from "./MatchCard.vue";

const rows = vi.hoisted(() => ({ scopes: [] as string[] }));
vi.mock("./BetRow.vue", () => ({ default: {
  props: ["quoteScope"], setup(props: { quoteScope: string }) { rows.scopes.push(props.quoteScope); return () => null; },
} }));
vi.mock("./RayBasketballSpreads.vue", () => ({ default: { render: () => null } }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ extensionPrefs: { pmPriceTrendUi: false } }) }));
vi.mock("@changmen/venue-browser/polymarket", () => ({
  pmMapOutcomeTick: { value: 0 }, lookupResolutionSourceBySourceMatchId: () => "https://www.hltv.org/",
}));

async function render(withRay: boolean) {
  const match = new ViewMatch({ ID: 1, Title: "A vs B", Game: "cs2", GameID: 1, StartTime: 1,
    Matchs: withRay ? { RAY: "ray/123", Polymarket: "pm-123" } : { Polymarket: "pm-123" }, Bets: [] });
  return renderToString(createSSRApp(MatchCard, { match }));
}

it("opens the matching RAY event in a separate page before the PM source", async () => {
  const html = await render(true);
  const link = html.match(/<a\b[^>]*class="ray-live-button"[^>]*>/)?.[0];
  expect(link).toContain('href="/ray-live.html?matchId=ray%2F123"');
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
  expect(html.indexOf('class="ray-live-button"')).toBeLessThan(html.indexOf('class="pm-sport"'));
  expect(await render(false)).not.toContain('class="ray-live-button"');
});

it("defaults PM-scoreboard esports to esports quotes and forwards an explicit sport quote scope", async () => {
  const match = new ViewMatch({ ID: 1, Title: "A vs B", Game: "cs2", GameID: 1, StartTime: 1,
    Matchs: { Polymarket: "pm-123" }, Bets: [], PmSport: { live: true, currentMap: 3 } });
  match.bets = [{ id: 1, round: 3 } as ViewBet];
  rows.scopes = [];
  await renderToString(createSSRApp(MatchCard, { match }));
  await renderToString(createSSRApp(MatchCard, { match, quoteScope: "sport", allowBetting: false }));
  expect(rows.scopes).toEqual(["esport", "sport"]);
});
