import { afterEach, expect, it, vi } from "vitest";
import { createRenderer, createSSRApp, h, ref, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { getPmRoutingPreference, getPmUserWsSourceMode, setPmRoutingPreference, getPmOrderSubmitMode, PM_ORDER_SUBMIT_MODE_KEY } from "@changmen/venue-adapter/polymarket";
import Badge from "./DirectRealtimeBadge.vue";

vi.mock("@/services/pmMaintenanceRealtime", () => ({
  startPmMaintenanceFeed: vi.fn(),
  usePmMaintenance: () => ({ state: ref("operational"), detail: ref(null) }),
}));
vi.mock("element-plus", async () => {
  const { h } = await import("vue");
  return {
    ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
    ElPopover: {
      setup(_props: unknown, { slots }: { slots: Record<string, (() => any) | undefined> }) {
        return () => h("div", [slots.reference?.(), slots.default?.()]);
      },
    },
  };
});
vi.mock("element-plus/es/components/popover/style/css", () => ({}));
vi.mock("element-plus/es/components/message/style/css", () => ({}));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("@changmen/venue-adapter/polymarket", async (original) => {
  const pm = await original<typeof import("@changmen/venue-adapter/polymarket")>();
  return {
    ...pm,
    applyPmAutoTransportOnLogin: vi.fn(async () => {
      const mode = pm.getPmRoutingPreference() === "relay" ? "changmen" : "official";
      pm.setPmUserWsSourceMode(mode);
      return { marketWsMode: mode, userWsMode: mode };
    }),
    setPmMarketWsSourceModeAndReconnect: vi.fn((mode: "official" | "changmen") => pm.setPmMarketWsSourceMode(mode)),
  };
});

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
function mount() {
  const app = renderer.createApp({ ...Badge, render: () => h("div") });
  app.provide(ssrContextKey, {});
  apps.push(app);
  const vm = app.mount(node());
  return (vm.$ as unknown as { setupState: Record<string, any> }).setupState;
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setPmRoutingPreference("auto");
  globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
});

it("preserves the existing PM market button's routing cycle without opening configuration", () => {
  setPmRoutingPreference("relay");
  const state = mount();
  state.handleVenueWsClick({ id: "pm-market" });
  expect(state.pmSettingsVisible).toBe(false);
  expect(getPmRoutingPreference()).toBe("auto");
});

it("explicit choices persist relay or automatic official-first routing", async () => {
  const state = mount();
  await state.selectPmConnectionMode("relay");
  expect(getPmRoutingPreference()).toBe("relay");
  expect(state.pmMarketWsSourceMode).toBe("changmen");
  await state.selectPmConnectionMode("auto");
  expect(getPmRoutingPreference()).toBe("auto");
  expect(state.pmMarketWsSourceMode).toBe("official");
  expect(state.pmSettingsBusy).toBe(false);
});

it("preserves the PM user WS toggle without opening configuration", () => {
  const state = mount();
  const before = getPmUserWsSourceMode();
  state.handleVenueWsClick({ id: "pm-user" });
  expect(getPmUserWsSourceMode()).toBe(before === "official" ? "changmen" : "official");
  expect(state.pmSettingsVisible).toBe(false);
});

it("persists local/VPS order choices across remounts and keeps query routing independent", async () => {
  setPmRoutingPreference("relay");
  const state = mount();
  expect(state.pmOrderSubmitMode).toBe("vps");
  state.selectPmOrderSubmitMode("local");
  expect(getPmOrderSubmitMode()).toBe("local");
  expect(getPmRoutingPreference()).toBe("relay");
  expect(mount().pmOrderSubmitMode).toBe("local");
  await state.selectPmConnectionMode("auto");
  expect(getPmOrderSubmitMode()).toBe("local");
  state.selectPmOrderSubmitMode("vps");
  expect(getPmOrderSubmitMode()).toBe("vps");
  expect(mount().pmOrderSubmitMode).toBe("vps");
});

it("a storage write failure keeps the displayed and effective order mode unchanged", () => {
  const state = mount();
  const storage = globalThis.localStorage;
  const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("storage full"); });
  try {
    state.selectPmOrderSubmitMode("local");
    expect(state.pmOrderSubmitMode).toBe("vps");
    expect(getPmOrderSubmitMode()).toBe("vps");
  }
  finally { write.mockRestore(); }
});

it("renders local/VPS buttons and their saved labels in both workspaces", async () => {
  for (const workspace of ["esport", "sports"] as const) {
    globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
    const render = async () => {
      const app = createSSRApp(Badge, { workspace });
      return renderToString(app);
    };
    const defaultHtml = await render();
    expect(defaultHtml).toContain("PM 配置 · 下单：VPS");
    expect(defaultHtml).toMatch(/aria-pressed="false"[^>]*>本地<\/button>/);
    expect(defaultHtml).toMatch(/aria-pressed="true"[^>]*>VPS<\/button>/);
    const state = mount();
    state.selectPmOrderSubmitMode("local");
    const localHtml = await render();
    expect(localHtml).toContain("PM 配置 · 下单：本地");
    expect(localHtml).toMatch(/aria-pressed="true"[^>]*>本地<\/button>/);
    expect(localHtml).toMatch(/aria-pressed="false"[^>]*>VPS<\/button>/);
  }
});
