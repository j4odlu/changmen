import type { Component } from "vue";
import type { ViewMatch } from "@/models/match";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { getPrematchFullMode, isPrematchFullMarketAllowed, resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly";
import { useMatchStore } from "@/stores/matchStore";
import HomeView from "./HomeView.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/input/style/css", () => ({}));
vi.mock("element-plus/es/components/container/style/css", () => ({}));
vi.mock("element-plus/es/components/aside/style/css", () => ({}));
vi.mock("element-plus/es/components/header/style/css", () => ({}));
vi.mock("element-plus/es/components/main/style/css", () => ({}));
vi.mock("vue-router", () => ({ useRouter: () => ({ resolve: () => ({ href: "/sports" }) }) }));
vi.mock("@/runtime/appSession", () => ({ mountAppSession: vi.fn(), stopAppSession: vi.fn() }));
vi.mock("@/composables/useExtensionGate", () => ({ useExtensionGate: () => ({ extensionReady: ref(false), extensionChecked: ref(false), refreshExtension: vi.fn() }) }));
vi.mock("@/components/account/AccountBar.vue", () => ({ default: {} }));
vi.mock("@/components/account/AccountEditDialog.vue", () => ({ default: {} }));
vi.mock("@/components/layout/AppSidebar.vue", () => ({ default: {} }));
vi.mock("@/components/layout/DirectRealtimeBadge.vue", () => ({ default: {} }));
vi.mock("@/components/match/CreateLoseDialog.vue", () => ({ default: {} }));
vi.mock("@/components/match/MatchCard.vue", () => ({ default: {} }));
vi.mock("@/components/order/ActiveBetRunView.vue", () => ({ default: {} }));
vi.mock("@/components/user/MakeupCalcBar.vue", () => ({ default: {} }));
vi.mock("@/extensions/pmOddsDropSignal/PmOddsDropSignalPanel.vue", () => ({ default: {} }));

interface Host { children: Host[]; parent: Host | null }
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node,
  createText: node,
  createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) {
    if (child.parent)
      child.parent.children = child.parent.children.filter(c => c !== child);
  },
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: child => child.parent,
  nextSibling: () => null,
});
let app: ReturnType<typeof renderer.createApp> | undefined;
beforeEach(() => { setActivePinia(createPinia()); resetPrematchFullOnlyForTests(); });
afterEach(() => { app?.unmount(); resetPrematchFullOnlyForTests(); });

it("can show all markets for manual betting without lifting the automatic prematch-full restriction", async () => {
  setPrematchFullMode("liveRound");
  const match = { id: 1, title: "A vs B", game: "CS", liveRound: 0, bets: [{ round: 0 }, { round: 1 }] } as ViewMatch;
  useMatchStore().matchs = [match];
  app = renderer.createApp({ render: () => h({ ...HomeView, render: () => h("div") } as Component) });
  app.provide(ssrContextKey, {});
  const vm = app.mount(node());
  const state = (vm.$.subTree.component as unknown as { setupState: { showAllMarketsForManual: boolean; filteredMatchs: ViewMatch[] } }).setupState;
  expect(state.filteredMatchs[0]?.bets.map(bet => bet.round)).toEqual([0]);
  state.showAllMarketsForManual = true;
  await nextTick();
  expect(state.filteredMatchs[0]?.bets.map(bet => bet.round)).toEqual([0, 1]);
  expect(getPrematchFullMode()).toBe("liveRound");
  expect(isPrematchFullMarketAllowed(match, match.bets[1]!)).toBe(false);
  state.showAllMarketsForManual = false;
  await nextTick();
  expect(state.filteredMatchs[0]?.bets.map(bet => bet.round)).toEqual([0]);
});
