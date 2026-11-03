import { expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { ViewMatch } from "@changmen/client-core/models/match";
import MatchCard from "./MatchCard.vue";

vi.mock("./BetRow.vue", () => ({ default: { render: () => null } }));
vi.mock("./RayBasketballSpreads.vue", () => ({ default: { render: () => null } }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ extensionPrefs: { pmPriceTrendUi: false } }) }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
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
