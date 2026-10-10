import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick, ssrContextKey } from "vue";
import { gtcOrderProjection, resetGtcOrderProjection } from "@/orderModes/gtc/executionProjection";
import App from "./App.vue";

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), user: { isLoggedIn: true, userId: "owner", extensionPrefs: { pmGtcV1Participant: false, pmArbOrderMode: "FOK", uiTheme: "default" } } }));
vi.mock("@/stores/orderStore", async () => {
  const { reactive } = await import("vue");
  const orders = reactive({ orders: new Map<number, { OrderID: string; PmGtcExecutionId?: string }[]>() });
  return { useOrderStore: () => orders };
});
vi.mock("@/stores/accountStore", async () => {
  const { reactive } = await import("vue");
  const accounts = reactive({ adminWorkspacePreview: false });
  return { useAccountStore: () => accounts };
});
vi.mock("@/stores/userStore", async () => {
  const { reactive } = await import("vue");
  const user = reactive(mocks.user);
  return { useUserStore: () => user };
});
vi.mock("pinia", async () => {
  const { toRefs } = await import("vue");
  return { storeToRefs: toRefs };
});
vi.mock("@/orderModes/gtc/runtime", () => ({ startGtcRuntime: mocks.start, stopGtcRuntime: mocks.stop }));
vi.mock("@/shared/applyUiTheme", () => ({ applyUiTheme: vi.fn() }));
vi.mock("@/components/account/PmVaultDialogs.vue", () => ({ default: { render: () => null } }));
vi.mock("element-plus", () => ({ ElConfigProvider: { render: () => null } }));

// 原组件的 watch 在真实 Vue effect scope 中运行，不需要浏览器或账户连接。
const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert: () => {},
  remove: () => {},
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null,
  patchProp: () => {},
});
let app: ReturnType<typeof renderer.createApp> | undefined;
async function flush() { await nextTick(); await vi.dynamicImportSettled(); await nextTick(); }
async function user() { return (await import("@/stores/userStore")).useUserStore() as unknown as typeof mocks.user; }
async function orders() { return (await import("@/stores/orderStore")).useOrderStore(); }
async function accounts() { return (await import("@/stores/accountStore")).useAccountStore(); }
beforeEach(async () => {
  resetGtcOrderProjection(); vi.clearAllMocks();
  (await orders()).orders = new Map(); (await accounts()).adminWorkspacePreview = false;
  const state = await user(); state.isLoggedIn = true; state.userId = "owner";
  Object.assign(state.extensionPrefs, { pmGtcV1Participant: false, pmArbOrderMode: "FOK" });
});
afterEach(() => { app?.unmount(); app = undefined; resetGtcOrderProjection(); });
function mount() {
  app = renderer.createApp({ ...App, render: () => null });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
}

describe("gTC recovery follows owned original orders", () => {
  it("ordinary FOK starts no GTC runtime", async () => {
    mount(); await flush(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("loaded originals recover with FOK selected and the participant hint absent", async () => {
    mount(); await flush();
    (await orders()).orders.set(1, [{ OrderID: "original", PmGtcExecutionId: "g" } as never]);
    await flush(); expect(mocks.start).toHaveBeenCalledWith("owner");
    expect((await user()).extensionPrefs.pmArbOrderMode).toBe("FOK");
  });
  it("switching preferences or filtering rows cannot stop recovery; logout does", async () => {
    const state = await user(); state.extensionPrefs.pmGtcV1Participant = true;
    mount(); await flush(); expect(mocks.start).toHaveBeenCalledWith("owner");
    state.extensionPrefs.pmGtcV1Participant = false; (await orders()).orders.clear();
    await flush(); expect(mocks.stop).not.toHaveBeenCalled();
    state.isLoggedIn = false; await flush(); expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("a different owner's projection cannot start recovery", async () => {
    gtcOrderProjection.owner = "foreign"; gtcOrderProjection.rows = [{ OrderID: "foreign", PmGtcExecutionId: "g" }];
    mount(); await flush(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("admin preview rows cannot start an account execution runtime", async () => {
    (await accounts()).adminWorkspacePreview = true;
    (await orders()).orders.set(1, [{ OrderID: "preview", PmGtcExecutionId: "g" } as never]);
    mount(); await flush(); expect(mocks.start).not.toHaveBeenCalled();
  });
});
