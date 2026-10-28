import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRenderer, createSSRApp, h, nextTick, reactive, ref, ssrContextKey, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { useOddsStore } from "@/stores/oddsStore";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { pmOddsDropSignals, pmUpSignals } from "@/extensions/pmSignals/records";
import { clearAllSignals, signalNow } from "@/extensions/pmSignals/state";
import { isMapMuteActive, resetMapBetMuteForTests, setFullMatchMuteGlobal } from "@/extensions/mapBetMute";
import {
  clearPmTickStateForTests, resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs,
} from "@changmen/venue-browser/adapter/polymarket";
import BetRow from "./BetRow.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/tag/style/css", () => ({}));
vi.mock("@/stores/createLoseDialogStore", () => ({ useCreateLoseDialogStore: () => ({ show: vi.fn() }) }));
vi.mock("@/components/match/LimitDiagDialog.vue", () => ({ default: {} }));
vi.mock("@/components/match/PmPrematchProbability.vue", () => ({ default: {} }));
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: {} }));
vi.mock("@/composables/useExtensionPrefs", () => ({ useBetRowExtensionUiEnabled: () => ref(true) }));
vi.mock("@/extensions/arbBet/ui", () => ({
  ArbLineOverlay: {},
  useBetRowArbUi: () => ({
    itemsContainerRef: ref(null), line: ref(null), badge: ref(null), overlayLabel: ref(undefined),
    isArbLeg: () => false, bindOddsAnchor: () => undefined,
    oddsCellClasses: () => ({}), sourceLabel: () => undefined,
  }),
}));

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});
const apps: ReturnType<typeof renderer.createApp>[] = [];
type State = {
  showPmLive: boolean;
  extensionBet: ViewBet;
  itemOdds: (item: ViewBetItem, side: BetSide) => number;
  itemQuotePending: (item: ViewBetItem, side: BetSide) => boolean;
  evMarker: { evLabel: (item: ViewBetItem, side: BetSide) => string | undefined };
  onOddsDblClick: (item: ViewBetItem, side: BetSide) => void;
  onPbShadowDblClick: (item: ViewBetItem, side: BetSide, e: MouseEvent) => void;
  onTarget: (platform: ViewBetItem["type"], side: BetSide) => void;
};
function item(type: ViewBetItem["type"]): ViewBetItem {
  return {
    type, betId: type, homeId: `${type}-home`, awayId: `${type}-away`,
    fallbackHomeOdds: 2, fallbackAwayOdds: 2,
    getItemId(side: BetSide) { return side === "Home" ? this.homeId : this.awayId; },
  } as ViewBetItem;
}
function mount(pmSport?: ViewMatch["pmSport"], round = 3, allowBetting = true) {
  const pm = item("Polymarket"); const pb = item("PB");
  const bet = reactive({ id: 1, round, items: [pm, pb], getBetName: () => `地图${round}` } as ViewBet);
  const match = reactive({ id: 1, liveRound: 0, pmSport } as ViewMatch);
  const odds = useOddsStore();
  for (const entry of bet.items) for (const side of ["Home", "Away"] as const)
    odds.save(entry.type, { id: entry.getItemId(side), odds: entry.type === "Polymarket" ? 3 : 1.9,
      clobPrice: 1 / 3, isLock: false, time: Date.now() });
  const app = renderer.createApp({ render: () => h({ ...BetRow, render: () => h("div") } as Component,
    { match, bet, allowBetting }) });
  app.provide(ssrContextKey, {}); apps.push(app);
  const vm = app.mount(node());
  const state = (vm.$.subTree.component as unknown as { setupState: State }).setupState;
  return { state, match, bet, pm: bet.items[0]!, pb: bet.items[1]! };
}
beforeEach(() => {
  setActivePinia(createPinia()); clearPmTickStateForTests(); resetPmArbPriceBufferPrefsForTests();
  resetMapBetMuteForTests();
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  resetPmArbPriceBufferPrefsForTests(); vi.restoreAllMocks();
  resetMapBetMuteForTests();
  clearAllSignals();
});

it("places PM signal badges in real odds cells and suppresses them on read-only, closed or display-disabled markets", async () => {
  const { match, bet, pm, pb } = mount();
  const user = useUserStore();
  user.extensionPrefs.pmOddsDropCardUi = true;
  user.extensionPrefs.pmUp.enabled = true;
  user.extensionPrefs.pmUpCardUi = true;
  const at = Date.now();
  signalNow.value = at;
  pmOddsDropSignals.value = [{
    id: "drop", assetId: pm.homeId, referenceVenue: "Polymarket", sourceMode: "official", selection: null,
    beforeOdds: 2, currentOdds: 1.8, beforeBestAsk: .5, currentBestAsk: 1 / 1.8,
    dropPct: 10, windowMs: 1000, baselineAt: at - 1000, detectedAt: at,
    venueSnapshot: { matchId: match.id, betId: bet.id, matchTitle: "Alpha vs Beta", marketTitle: "地图3", side: "Home", sideLabel: "Alpha",
      referenceVenue: "Polymarket", pm: { odds: 1.8, evPercent: 0 }, ob: null, ray: null, pb: { odds: 1.9, evPercent: 5.56, itemId: pb.homeId } },
  }];
  pmUpSignals.value = [{
    key: "pm-up", id: "up", assetId: pm.homeId, matchId: match.id, betId: bet.id,
    matchTitle: "Alpha vs Beta", marketTitle: "地图3", pmSide: "Home", pmSideLabel: "Alpha", targetSide: "Away", targetSideLabel: "Beta",
    beforeOdds: 1.8, pmOdds: 2.2, risePct: 22.22, baselineAt: at - 1000, detectedAt: at,
    target: { provider: "PB", itemId: pb.awayId, odds: 2 }, arbPct: 4.76,
  }];
  const render = (allowBetting = true) => renderToString(createSSRApp(BetRow, { match, bet, allowBetting }).use(getActivePinia()!));
  const html = await render();
  expect(html).toContain("with-odds-signals");
  expect(html.replace(/<[^>]*>/g, "")).toContain("↓10.0%");
  expect(html.replace(/<[^>]*>/g, "")).toContain("↑22.2%");
  expect(html.replace(/<[^>]*>/g, "")).toContain("2.0001.800");
  expect(html.replace(/<[^>]*>/g, "")).toContain("2.2001.800");
  expect(html).toContain("高+5.6%");
  expect(html).toContain("套+4.8%");
  user.extensionPrefs.pmUp.enabled = false;
  expect((await render()).replace(/<[^>]*>/g, "")).toContain("↑22.2%");
  user.extensionPrefs.pmUpCardUi = false;
  expect((await render()).replace(/<[^>]*>/g, "")).not.toContain("↑22.2%");
  expect((await render()).replace(/<[^>]*>/g, "")).toContain("↓10.0%");
  expect(await render(false)).not.toContain('class="pm-odds-badge ');
  match.pmSport = { ended: true, status: "finished" };
  expect(await render()).not.toContain('class="pm-odds-badge ');
  match.pmSport = undefined;
  user.extensionPrefs.pmOddsDropCardUi = false;
  user.extensionPrefs.pmUp.enabled = false;
  expect(await render()).not.toContain('class="pm-odds-badge ');
});

it("updates PM LIVE from VPS snapshots without elapsed independently of the OB live map", async () => {
  const { state, match, bet } = mount({ status: "running", live: true, currentMap: 3, period: "3/3" });
  expect(match.liveRound).toBe(0);
  expect(state.showPmLive).toBe(true);
  match.liveRound = 2;
  match.pmSport = { status: "running", period: "3/5" };
  await nextTick();
  expect(state.showPmLive).toBe(true);
  match.pmSport = { live: true, currentMap: 4 };
  await nextTick();
  expect(state.showPmLive).toBe(false);
  bet.round = 4;
  await nextTick();
  expect(state.showPmLive).toBe(true);
  match.pmSport = { ended: true, currentMap: 4 };
  await nextTick();
  expect(state.showPmLive).toBe(false);
});

it("renders PM LIVE in the real map-card template for the VPS running 3/3 snapshot", async () => {
  const { match, bet } = mount({ status: "running", live: true, currentMap: 3, period: "3/3",
    scoreRaw: "000-000|1-1|Bo3", mapScore: { home: 1, away: 1 } });
  const app = createSSRApp(BetRow, { match, bet }).use(getActivePinia()!);
  const html = await renderToString(app);
  expect(html).toMatch(/class="[^"]*pm-live[^"]*"/);
  expect(html).toContain("PM LIVE");
});

it("does not infer PM LIVE from OB and excludes full-match and other market cards", async () => {
  const { state, match, bet } = mount();
  match.liveRound = 3;
  match.liveRoundStart = Date.now() - 60_000;
  expect(state.showPmLive).toBe(false);
  match.pmSport = { live: true, currentMap: 3 };
  await nextTick();
  expect(state.showPmLive).toBe(true);
  bet.marketCode = "total";
  await nextTick();
  expect(state.showPmLive).toBe(false);
  bet.marketCode = undefined;
  bet.round = 0;
  await nextTick();
  expect(state.showPmLive).toBe(false);
});

it("missing tick is pending for an open match, then locks immediately when the match finishes", async () => {
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  const { state, match, pm, pb } = mount({ live: true, currentMap: 3 });
  expect(state.itemOdds(pm, "Away")).toBe(0);
  expect(state.itemQuotePending(pm, "Away")).toBe(true);
  match.pmSport = { ended: true, status: "finished" };
  await nextTick();
  for (const side of ["Home", "Away"] as const) {
    expect(state.itemOdds(pm, side)).toBe(0);
    expect(state.itemQuotePending(pm, side)).toBe(false);
    expect(state.itemOdds(pb, side)).toBe(1.9);
  }
  expect(useOddsStore().getEntry("Polymarket", pm.awayId)?.isLock).toBe(false);
});

it.each([{ ended: true }, { status: "finished" }, { status: "final" },
  { bo: 3, mapScore: { home: 2, away: 1 } }, { live: true, currentMap: 4 }])(
  "blocks stale PM quotes and excludes them from extensions: %j", pmSport => {
    const { state, pm, pb, bet } = mount(pmSport);
    expect(state.itemOdds(pm, "Home")).toBe(0);
    expect(state.itemQuotePending(pm, "Home")).toBe(false);
    expect(state.extensionBet.items).toEqual([pb]);
    expect(state.evMarker.evLabel(pm, "Home")).toBeUndefined();
    expect(bet.items).toHaveLength(2);
    const manual = vi.spyOn(useMatchStore(), "manualBet").mockResolvedValue(undefined);
    const target = vi.spyOn(useMatchStore(), "setBetTarget").mockResolvedValue(true);
    state.onOddsDblClick(pm, "Home"); state.onTarget("Polymarket", "Home");
    expect(manual).not.toHaveBeenCalled(); expect(target).not.toHaveBeenCalled();
  },
);

it("open PM quotes and EV labels stay available when the series has not been decided", () => {
  const { state, pm, bet } = mount({ live: true, currentMap: 3, bo: 3, mapScore: { home: 1, away: 1 } });
  expect(state.itemOdds(pm, "Home")).toBe(3);
  expect(state.evMarker.evLabel(pm, "Home")).toBe("+50.0%");
  expect(state.extensionBet).toBe(bet);
});

it("does not apply esports series-score rules to a sports read-only row", () => {
  const { state, pm, bet } = mount({ live: true, mapScore: { home: 2, away: 1 } }, 0, false);
  expect(state.itemOdds(pm, "Home")).toBe(3);
  expect(state.extensionBet).toBe(bet);
});

it("missing PM match status does not block an otherwise valid quote", () => {
  const { state, pm } = mount();
  expect(state.itemOdds(pm, "Home")).toBe(3);
  expect(state.itemQuotePending(pm, "Home")).toBe(false);
});

it("muted rows allow manual double-clicks while target selection and automatic mute stay unchanged", () => {
  setFullMatchMuteGlobal(true);
  const { state, match, bet, pb } = mount(undefined, 0);
  const manual = vi.spyOn(useMatchStore(), "manualBet").mockResolvedValue(undefined);
  const target = vi.spyOn(useMatchStore(), "setBetTarget").mockResolvedValue(true);
  state.onOddsDblClick(pb, "Away");
  state.onPbShadowDblClick(pb, "Home", { stopPropagation: vi.fn() } as unknown as MouseEvent);
  state.onTarget("PB", "Away");
  expect(manual).toHaveBeenCalledTimes(2);
  expect(target).not.toHaveBeenCalled();
  expect(isMapMuteActive(match.id, bet.round, match.liveRound)).toBe(true);
});

it("sports read-only rows still reject manual double-clicks", () => {
  const { state, pb } = mount(undefined, 0, false);
  const manual = vi.spyOn(useMatchStore(), "manualBet").mockResolvedValue(undefined);
  state.onOddsDblClick(pb, "Away");
  state.onPbShadowDblClick(pb, "Home", { stopPropagation: vi.fn() } as unknown as MouseEvent);
  expect(manual).not.toHaveBeenCalled();
});
