import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ssrContextKey } from "vue";
import View from "./AdminBetProfitAnalyticsView.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/alert/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/tabs/style/css", () => ({}));
vi.mock("element-plus/es/components/tab-pane/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-group/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-button/style/css", () => ({}));
vi.mock("element-plus/es/components/date-picker/style/css", () => ({}));

const mocks = vi.hoisted(() => ({ load: vi.fn(), replace: vi.fn(), user: { ready: true, isAdmin: true, canAccessAdmin: true } }));
vi.mock("@/api/admin", () => ({ getAdminBetProfitAnalytics: mocks.load }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/admin/AdminLayout.vue", () => ({ default: {} }));
vi.mock("@/components/admin/AdminBetProfitStatsSection.vue", () => ({ default: {} }));

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});
let app: ReturnType<typeof renderer.createApp>;
type State = { mode: "obSingle" | "valueBet"; rangeMode: "day" | "month" | "all"; fetchData: () => Promise<void>; valueBet: unknown; loading: boolean; errorMsg: string };
async function mount() {
  app = renderer.createApp({ ...View, render: () => h("div") });
  app.provide(ssrContextKey, {});
  const vm = app.mount(node());
  await nextTick();
  return (vm.$ as unknown as { setupState: State }).setupState;
}
const payload = { byProvider: [], byOddsBucket: [], byDay: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.user.isAdmin = true; mocks.load.mockResolvedValue(payload); });
afterEach(() => app?.unmount());

describe("combined admin profit page", () => {
  it("loads OB by default and sends the selected EV/all-history mode", async () => {
    const state = await mount();
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ mode: "obSingle", date: expect.any(String) }));
    state.mode = "valueBet"; state.rangeMode = "all";
    await state.fetchData();
    expect(mocks.load).toHaveBeenLastCalledWith({ mode: "valueBet", period: "all", all: "1" });
  });
  it("redirects team leaders without issuing analytics requests", async () => {
    mocks.user.isAdmin = false;
    await mount();
    expect(mocks.replace).toHaveBeenCalledWith({ name: "home" });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([false, true])("ignores a stale OB response/failure after switching to EV (failure=%s)", async (failure) => {
    let finish!: (value: unknown) => void, fail!: (error: Error) => void;
    mocks.load.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const state = await mount();
    state.mode = "valueBet";
    await state.fetchData();
    if (failure) fail(new Error("stale failure")); else finish({ old: true });
    await nextTick();
    expect(state.valueBet).toEqual(payload);
    expect(state.errorMsg).toBe("");
    expect(state.loading).toBe(false);
  });
  it("clears old results and reports failures without a zero-profit report", async () => {
    const state = await mount();
    mocks.load.mockRejectedValueOnce(new Error("服务暂不可用"));
    await state.fetchData();
    expect(state.errorMsg).toBe("服务暂不可用");
    expect(state.valueBet).toBeNull();
    expect(state.loading).toBe(false);
  });
});
