import { expect, it, vi } from "vitest";
import { createSSRApp, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { ViewMatch } from "@changmen/client-core/models/match";
import { useOddsStore } from "@/stores/oddsStore";
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

it("renders matcher-retained OB/RAY markets as locks through unchanged A8 rendering despite stale quotes", async () => {
  const pinia = createPinia(); setActivePinia(pinia);
  const odds = useOddsStore();
  for (const platform of ["OB", "RAY"] as const)
    for (const id of ["old-h", "old-a"])
      odds.save(platform, { id, odds: 2.123, isLock: false, time: Date.now() });
  const source = { BetID: "old-market", HomeID: "", AwayID: "", HomeOdds: 0, AwayOdds: 0, Status: "Locked" };
  const match = new ViewMatch({ ID: 42, Title: "Alpha vs Beta", Game: "cs2", GameID: 3,
    StartTime: 1800000000000, Matchs: { OB: "old-ob", RAY: "old-ray" }, Bets: [{ ID: 172033, MatchID: 42,
      Map: 1, Name: "[地图1]-获胜", HomeID: 1, AwayID: 2, HomeName: "Alpha", AwayName: "Beta",
      Sources: { OB: { ...source, Type: "OB" }, RAY: { ...source, Type: "RAY" } } }] });
  const html = await renderToString(createSSRApp(BetRow, { match, bet: match.bets[0]! }).use(pinia));
  const locked = [...html.matchAll(/class="([^"]*)"/g)].filter(row => {
    const classes = row[1]!.split(" "); return classes.includes("item-odds") && classes.includes("lock");
  });
  expect(locked).toHaveLength(4);
  expect(html).not.toContain("2.123");
  expect(match.bets[0]!.items.map(item => item.betId)).toEqual(["old-market", "old-market"]);
});
