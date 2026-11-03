import type { ViewMatch } from "@changmen/client-core/models/match";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import * as Vue from "vue";
import { createRenderer, createSSRApp, h, nextTick, ssrContextKey, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useUserStore } from "@/stores/userStore";
import MatchCard from "@/components/match/MatchCard.vue";
import cardSource from "@/components/match/MatchCard.vue?raw";
import UiTab from "@/components/user/tabs/UserDiagUiTab.vue";

const mocks = vi.hoisted(() => ({
  mount: vi.fn(), unmount: vi.fn(), save: vi.fn(),
  toggle: undefined as undefined | ((value: boolean) => void),
  saveButton: undefined as undefined | (() => Promise<void>),
  switchValue: undefined as undefined | boolean,
}));
vi.mock("@/stores/userStore", async () => {
  const { defineStore } = await import("pinia");
  const { createDefaultExtensionPrefs } = await import("@/types/extensionPrefs");
  return { useUserStore: defineStore("trend-settings-test", {
    state: () => ({ extensionPrefs: createDefaultExtensionPrefs() }),
    actions: { saveExtensionPrefs: mocks.save },
  }) };
});
vi.mock("@/components/match/BetRow.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/match/RayBasketballSpreads.vue", () => ({ default: { render: () => null } }));
vi.mock("./PmPriceTrend.vue", async () => {
  const { defineComponent, onMounted, onUnmounted } = await import("vue");
  return { default: defineComponent({ setup() { onMounted(mocks.mount); onUnmounted(mocks.unmount); return () => null; } }) };
});
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ pmMapOutcomeTick: { value: 0 }, lookupResolutionSourceBySourceMatchId: () => null }));
vi.mock("@/components/user/PmPfBufferSettings.vue", () => ({ default: { render: () => null } }));
vi.mock("@/extensions/pmSignals/SignalSettings.vue", () => ({ default: { render: () => null } }));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/form/style/css", () => ({}));
vi.mock("element-plus/es/components/form-item/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-group/style/css", () => ({}));
vi.mock("element-plus/es/components/radio/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-button/style/css", () => ({}));
vi.mock("element-plus/es/components/input-number/style/css", () => ({}));
vi.mock("element-plus/es/components/switch/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }));
vi.mock("element-plus/es", async () => {
  const { defineComponent, h } = await import("vue");
  const container = defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) });
  return {
    ElMessage: { success: vi.fn(), error: vi.fn() },
    ElForm: container, ElFormItem: container, ElRadioGroup: container, ElRadio: container,
    ElRadioButton: container, ElInputNumber: container,
    ElSwitch: defineComponent({ props: ["modelValue"], emits: ["update:modelValue"], setup(props, { attrs, emit }) {
      if (attrs["aria-label"] === "显示 PM 价格趋势") {
        mocks.switchValue = props.modelValue;
        mocks.toggle = value => emit("update:modelValue", value);
      }
      return () => null;
    } }),
    ElButton: defineComponent({ setup(_props, { attrs }) { mocks.saveButton = attrs.onClick as typeof mocks.saveButton; return () => null; } }),
  };
});

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child); },
  setText() {}, setElementText() {}, patchProp() {}, parentNode: child => child.parent, nextSibling: () => null,
});
let app: ReturnType<typeof renderer.createApp> | undefined;
afterEach(() => { app?.unmount(); app = undefined; vi.clearAllMocks(); });

it("uses the UI switch immediately to mount/unmount the trend independently, then uses the existing save action", async () => {
  const pinia = createPinia(); setActivePinia(pinia);
  const user = useUserStore();
  const { descriptor } = parse(cardSource);
  const { code } = compile(descriptor.template!.content, { mode: "function", prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: "trend-settings-card" }).bindings });
  const card = { ...MatchCard, render: new Function("Vue", code)(Vue) } as Component;
  const match = { id: 1, title: "A vs B", game: "cs2", startAt: 1, providers: {}, bets: [] } as unknown as ViewMatch;
  app = renderer.createApp({ render: () => h(card, { match }) }).use(pinia); app.provide(ssrContextKey, {}); app.mount(node());
  const html = await renderToString(createSSRApp(UiTab).use(pinia));
  expect(html).toContain("PM 价格趋势:"); expect(html).toContain("默认关闭");
  expect(mocks.switchValue).toBe(false); expect(mocks.mount).not.toHaveBeenCalled();
  mocks.toggle!(true); await nextTick();
  expect(user.extensionPrefs.pmPriceTrendUi).toBe(true); expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(user.extensionPrefs.betRowUi).toBe(false); expect(mocks.save).not.toHaveBeenCalled();
  await mocks.saveButton!(); expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.toggle!(false); await nextTick();
  expect(mocks.unmount).toHaveBeenCalledTimes(1);
  // 旧设置对象没有新字段时也不会悄悄打开。
  Reflect.deleteProperty(user.extensionPrefs, "pmPriceTrendUi");
  await nextTick(); expect(mocks.mount).toHaveBeenCalledTimes(1);
});
