import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { ViewMatch } from "@changmen/client-core/models/match";
import { clearRayMapOutcomes, updateRayMapOutcomes } from "../../../../../packages/venue-adapter/ray/rayMapOutcome";
import BetRow from "./BetRow.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/tag/style/css", () => ({}));
vi.mock("@/stores/createLoseDialogStore", () => ({ useCreateLoseDialogStore: () => ({ show: vi.fn() }) }));
vi.mock("@/components/match/LimitDiagDialog.vue", () => ({ default: {} }));
vi.mock("@/components/match/PmPrematchProbability.vue", () => ({ default: {} }));
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: {} }));
vi.mock("@/composables/useExtensionPrefs", () => ({ useBetRowExtensionUiEnabled: () => ref(false) }));
vi.mock("@/extensions/arbBet/ui", () => ({
  ArbLineOverlay: {}, useBetRowArbUi: () => ({
    itemsContainerRef: ref(null), line: ref(null), badge: ref(null), overlayLabel: ref(undefined),
    isArbLeg: () => false, bindOddsAnchor: () => undefined, oddsCellClasses: () => ({}), sourceLabel: () => undefined,
  }),
}));

beforeEach(() => setActivePinia(createPinia()));
afterEach(clearRayMapOutcomes);

it.each([false, true])("overlays exactly one WIN on the settled RAY side, keeping a locked cell and other venues intact (reversed=%s)", async reversed => {
  const match = new ViewMatch({ ID: 8210, Title: "6yuBoJlbl vs HYPERSPIRIT", Game: "cs2", GameID: 1,
    StartTime: 1792359000000, Matchs: { RAY: "38457365", Polymarket: "1207914" }, Bets: [{
      ID: 33628161, MatchID: 8210, Map: 1, Name: "[地图1]-获胜者", HomeID: 1, AwayID: 2,
      HomeName: reversed ? "HYPERSPIRIT" : "6yuBoJlbl", AwayName: reversed ? "6yuBoJlbl" : "HYPERSPIRIT",
      Sources: {
        RAY: { Type: "RAY", BetID: "16854", HomeID: reversed ? "76661674" : "76661673", AwayID: reversed ? "76661673" : "76661674", HomeOdds: 1.56, AwayOdds: 2.37, Status: "Locked" },
        Polymarket: { Type: "Polymarket", BetID: "pm", HomeID: "pm-h", AwayID: "pm-a", HomeOdds: 0, AwayOdds: 1000, Status: "Locked" },
      },
    }],
  });
  const bet = match.bets[0]!;
  const render = () => renderToString(createSSRApp(BetRow, { match, bet }).use(createPinia()));
  expect(await render()).not.toContain("ray-map-win-badge");
  const settled = { id: 38457365, team: [{ pos: 1, team_id: 38456820 }, { pos: 2, team_id: 38020689 }], odds: [
    { odds_group_id: 16854, odds_id: 76661673, team_id: 38456820, match_stage: "map1", status: 5, win: 1, group_name: "获胜者" },
    { odds_group_id: 16854, odds_id: 76661674, team_id: 38020689, match_stage: "map1", status: 5, win: 0, group_name: "获胜者" },
  ] };
  updateRayMapOutcomes("38457365", settled, /^获胜者$/, "cs2");
  const html = await render();
  expect(html.match(/class="ray-map-win-badge"/g)).toHaveLength(1);
  const winnerClasses = html.match(/class="([^"]*ray-map-won[^"]*)"/)?.[1]?.split(/\s+/);
  expect(winnerClasses).toEqual(expect.arrayContaining(["item-odds", "lock", reversed ? "away" : "home"]));
  expect(html).toContain('title="RAY 已确认本方赢得该地图">WIN</span>');
  expect(html.match(/ray-map-lost/g)).toHaveLength(1);
  expect(bet.items[0]!.sourceStatus).toBe("Locked");
  expect(bet.items[0]!.fallbackHomeOdds).toBe(0);
  settled.odds[0]!.win = -1;
  updateRayMapOutcomes("38457365", settled, /^获胜者$/, "cs2");
  expect(await render()).not.toContain("ray-map-win-badge");
});
