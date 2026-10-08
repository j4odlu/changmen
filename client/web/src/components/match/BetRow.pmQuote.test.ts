import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { useOddsStore } from "@/stores/oddsStore";
import { useMatchStore } from "@/stores/matchStore";
import {
  clearPmTickStateForTests, resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs,
} from "@changmen/venue-adapter/polymarket";
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
  extensionBet: ViewBet;
  itemOdds: (item: ViewBetItem, side: BetSide) => number;
  itemQuotePending: (item: ViewBetItem, side: BetSide) => boolean;
  evMarker: { evLabel: (item: ViewBetItem, side: BetSide) => string | undefined };
  onOddsDblClick: (item: ViewBetItem, side: BetSide) => void;
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
  const bet = reactive({ id: 1, round, items: [pm, pb] } as ViewBet);
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
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  resetPmArbPriceBufferPrefsForTests(); vi.restoreAllMocks();
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
