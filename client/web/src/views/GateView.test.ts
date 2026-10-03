import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey } from "vue";
import GateView from "./GateView.vue";

const mock = vi.hoisted(() => ({
  user: {} as { ready: boolean; sessionChecked: boolean; sessionRestoreError: string },
  cert: {} as { value: boolean },
  extension: {} as { value: boolean },
}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mock.user }));
vi.mock("vue-router", () => ({ useRoute: () => ({ path: "/sports/football" }), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/composables/useCertGate", () => ({ useCertGate: () => ({ certReady: mock.cert, certChecked: { value: true } }) }));
vi.mock("@/composables/useExtensionGate", () => ({ useExtensionGate: () => ({ extensionReady: mock.extension, extensionChecked: { value: true } }) }));
vi.mock("@/components/auth/LoginPanel.vue", () => ({ default: {} }));
vi.mock("@/components/layout/SessionRestoreLoader.vue", () => ({ default: {} }));
vi.mock("@/components/layout/PluginIntroShell.vue", () => ({ default: {} }));

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
function mount() {
  app = renderer.createApp({ ...GateView, render: () => h("div") });
  app.provide(ssrContextKey, {});
  const vm = app.mount(node());
  return (vm.$ as unknown as { setupState: { showLoginGate: boolean; showSessionRestore: boolean } }).setupState;
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.user = reactive({ ready: false, sessionChecked: false, sessionRestoreError: "" });
  mock.cert = ref(true);
  mock.extension = ref(true);
});
afterEach(() => { app.unmount(); vi.useRealTimers(); });

describe("football login during session recovery", () => {
  it("offers login after 12 seconds even when session restoration never resolves", async () => {
    const state = mount();
    expect(state.showSessionRestore).toBe(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(state.showLoginGate).toBe(true);
    expect(state.showSessionRestore).toBe(false);
    expect(mock.user.sessionChecked).toBe(false);
  });
  it("offers login immediately when restoration reports an outage", () => {
    mock.user.sessionRestoreError = "连接暂时不可用，请检查网络后重试";
    expect(mount().showLoginGate).toBe(true);
  });
  it("retains certificate and extension requirements during a slow recovery", async () => {
    mock.cert.value = false;
    const state = mount();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(state.showLoginGate).toBe(false);
    mock.cert.value = true;
    mock.extension.value = false;
    await nextTick();
    expect(state.showLoginGate).toBe(false);
  });
  it("cancels the slow-recovery timer when the session becomes ready", async () => {
    mount();
    mock.user.ready = true;
    await nextTick();
    expect(vi.getTimerCount()).toBe(0);
  });
});
