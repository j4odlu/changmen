import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, ssrContextKey } from "vue";
import AdminHealthView from "./AdminHealthView.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/alert/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/progress/style/css", () => ({}));
vi.mock("element-plus/es/components/tag/style/css", () => ({}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ ready: true, canAccessAdmin: true }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/api/client", () => ({ authHeaders: () => ({ "X-Changmen-Auth": "cookie" }) }));
vi.mock("@/config/apiBase", () => ({ getApiBase: () => "https://api.example.com" }));
vi.mock("@/components/admin/AdminLayout.vue", () => ({ default: {} }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({
  getPmExecutionMetricsSummary: () => ({}),
  getPmMarketClientMetricsSnapshot: () => ({}),
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
let app: ReturnType<typeof renderer.createApp>;
const fullHealth = { status: "degraded", uptime: 1, db: { connected: false }, memory: {}, data: {}, wsForward: {} };
const fetchMock = vi.fn();
let healthStatus: number;
let healthPayload: unknown;
async function mount() {
  app = renderer.createApp({ ...AdminHealthView, render: () => h("div") });
  app.provide(ssrContextKey, {});
  const vm = app.mount(node());
  await vi.advanceTimersByTimeAsync(0);
  return (vm.$ as unknown as { setupState: { health: unknown; error: string; pmMarketObsError: string } }).setupState;
}
beforeEach(() => {
  vi.useFakeTimers();
  healthStatus = 200;
  healthPayload = fullHealth;
  fetchMock.mockReset().mockImplementation(async (url: string, options: RequestInit) => {
    const main = url.endsWith("/health");
    // Simulate an API on another origin: cookie authentication requires include.
    const authenticated = options.credentials === "include";
    return {
      ok: main ? healthStatus < 400 : false,
      status: main ? healthStatus : 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => main ? (authenticated ? healthPayload : { status: "ok" }) : { error: "无管理权限" },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { app?.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("admin health cookie requests", () => {
  it("loads full health from a separate API origin and authenticates both probes", async () => {
    const state = await mount();
    expect(state.health).toEqual(fullHealth);
    expect(state.error).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls)
      expect(options).toMatchObject({ credentials: "include", cache: "no-store", headers: { "X-Changmen-Auth": "cookie" } });
    expect(state.pmMarketObsError).toBe("无管理权限");
  });
  it("keeps degraded health visible when the database probe returns 503", async () => {
    healthStatus = 503;
    const state = await mount();
    expect(state.health).toEqual(fullHealth);
    expect(state.error).toBe("");
  });
  it("reports an authentication service outage instead of incomplete data", async () => {
    healthStatus = 503;
    healthPayload = { error: "登录服务暂时不可用", code: "TEMPORARY_UNAVAILABLE" };
    const state = await mount();
    expect(state.health).toBeNull();
    expect(state.error).toBe("登录服务暂时不可用");
  });
  it("does not treat the public liveness response as full health", async () => {
    healthPayload = { status: "ok" };
    const state = await mount();
    expect(state.health).toBeNull();
    expect(state.error).toContain("健康检查数据不完整");
  });
});
