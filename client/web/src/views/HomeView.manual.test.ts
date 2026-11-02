import type { Component } from "vue";
import type { ViewMatch } from "@/models/match";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { getPrematchFullMode, isPrematchFullMarketAllowed, resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly";
import { useMatchStore } from "@/stores/matchStore";
import { isMapMuteActive, resetMapBetMuteForTests, setMapMuteGlobal } from "@/extensions/mapBetMute";
import HomeView from "./HomeView.vue";
import homeSource from "./HomeView.vue?raw";

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
vi.mock("@/components/order/SingleLegMonitor.vue", () => ({ default: {} }));
vi.mock("@/components/user/MakeupCalcBar.vue", () => ({ default: {} }));
vi.mock("@/extensions/pmSignals/PmSignalsPanel.vue", () => ({ default: {} }));

interface Host { children: Host[]; parent: Host | null; tag: string; text: string; props: Record<string, unknown> }
const node = (tag = "", text = ""): Host => ({ children: [], parent: null, tag, text, props: {} });
const renderer = createRenderer<Host, Host>({
  createElement: node,
  createText: text => node("#text", text),
  createComment: text => node("#comment", text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child);
    else parent.children.splice(index, 0, child);
  },
  remove(child) {
    if (child.parent)
      child.parent.children = child.parent.children.filter(c => c !== child);
  },
  setText(host, text) { host.text = text; },
  setElementText(host, text) { host.text = text; host.children = []; },
  patchProp(host, key, _prev, value) { host.props[key] = value; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
let app: ReturnType<typeof renderer.createApp> | undefined;
beforeEach(() => { setActivePinia(createPinia()); resetPrematchFullOnlyForTests(); resetMapBetMuteForTests(); });
afterEach(() => { app?.unmount(); resetPrematchFullOnlyForTests(); resetMapBetMuteForTests(); });

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

it("the rendered map4 button toggles closure, label and aria state without lifting the all-market switch", async () => {
  // Vitest imports SFCs in SSR mode; compile the actual template for interactive rendering.
  const { descriptor } = parse(homeSource);
  const { code } = compile(descriptor.template!.content, { mode: "function", prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: "home-map4-test" }).bindings });
  const render = new Function("Vue", code)(Vue);
  app = renderer.createApp({ ...HomeView, render } as Component);
  const container = Vue.defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
  for (const name of ["el-container", "el-aside", "el-header", "el-main", "el-button", "el-input"])
    app.component(name, container);
  app.provide(ssrContextKey, {});
  const root = node();
  app.mount(root);
  const flatten = (host: Host): Host[] => [host, ...host.children.flatMap(flatten)];
  const button = () => flatten(root).find(host => host.tag === "button" && host.text.includes("地图4"))!;
  expect(button().text.trim()).toBe("关 地图4");
  expect(button().props["aria-pressed"]).toBe(false);
  (button().props.onClick as () => void)();
  await nextTick();
  expect(button().text.trim()).toBe("开 地图4");
  expect(button().props["aria-pressed"]).toBe(true);
  expect(isMapMuteActive(99, 4, 0)).toBe(true);
  expect(isMapMuteActive(99, 3, 0)).toBe(false);
  setMapMuteGlobal(true);
  (button().props.onClick as () => void)();
  await nextTick();
  expect(button().text.trim()).toBe("关 地图4");
  expect(button().props["aria-pressed"]).toBe(false);
  expect(isMapMuteActive(99, 4, 0)).toBe(true);
});
