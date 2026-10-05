import { afterEach, expect, it, vi } from "vitest";
import { createRenderer, h, ref, ssrContextKey } from "vue";
import { getPmRoutingPreference, setPmRoutingPreference } from "@changmen/venue-adapter/polymarket";
import Badge from "./DirectRealtimeBadge.vue";

vi.mock("@/services/pmMaintenanceRealtime", () => ({
  startPmMaintenanceFeed: vi.fn(),
  usePmMaintenance: () => ({ state: ref("operational"), detail: ref(null) }),
}));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }));
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
});

it("clicking either PM status opens settings without cycling the user's preference", () => {
  setPmRoutingPreference("relay");
  const state = mount();
  for (const id of ["pm-market", "pm-user"]) {
    state.pmSettingsVisible = false;
    state.handleVenueWsClick({ id });
    expect(state.pmSettingsVisible).toBe(true);
    expect(getPmRoutingPreference()).toBe("relay");
  }
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
