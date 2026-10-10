import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { useUserStore } from "@/stores/userStore";
import Dialog from "./UserConfigDialog.vue";

const mocks = vi.hoisted(() => ({
  mounted: undefined as (() => Promise<void>) | undefined,
  saveClick: undefined as (() => Promise<void>) | undefined,
  save: vi.fn(),
  refresh: vi.fn(),
  resume: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  records: [] as { released: boolean; manual: boolean }[],
}));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), onMounted: (callback: () => Promise<void>) => { mocks.mounted = callback; } }));
vi.mock("@/components/user/UserConfigPanel.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_props, { slots }) => () => h("div", slots.footer?.()) }) };
});
vi.mock("@/stores/userStore", async () => {
  const { defineStore } = await import("pinia");
  const { createDefaultUserConfig } = await import("@/types/userConfig");
  const { createDefaultExtensionPrefs } = await import("@/types/extensionPrefs");
  return { useUserStore: defineStore("fok-config-save-test", {
    state: () => ({ userId: 12, configLoaded: true, configSaving: false, extrasLoaded: true, config: { ...createDefaultUserConfig(), betting: true }, extensionPrefs: createDefaultExtensionPrefs() }),
    actions: { loadExtras: vi.fn(), loadConfig: vi.fn(), saveConfig: mocks.save, fetchUserInfo: mocks.info, saveExtensionPrefs: vi.fn() },
  }) };
});
vi.mock("@/orderModes/gtc/runtime", () => ({
  refreshGtcRecords: mocks.refresh,
  resumeGtcAfterManualReview: mocks.resume,
  gtcProgress: { get records() { return mocks.records; } },
}));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/dialog/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn(), error: mocks.error }, ElMessageBox: { confirm: mocks.confirm } }));
vi.mock("element-plus/es", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    ElMessage: { success: vi.fn(), error: mocks.error },
    ElMessageBox: { confirm: mocks.confirm },
    ElDialog: defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }),
    ElButton: defineComponent({ setup: (_props, { slots, attrs }) => { mocks.saveClick = attrs.onClick as () => Promise<void>; return () => h("button", slots.default?.()); } }),
  };
});
async function saveDialog() {
  await renderToString(createSSRApp(Dialog, { open: true }));
  expect(mocks.mounted).toBeDefined();
  await mocks.mounted!();
  expect(mocks.saveClick).toBeDefined();
  await mocks.saveClick!();
}
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  mocks.mounted = undefined; mocks.saveClick = undefined;
  mocks.records = [{ released: false, manual: true }];
  mocks.save.mockResolvedValue({ ok: true }); mocks.refresh.mockResolvedValue(undefined);
  mocks.resume.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue("confirm");
});
describe("configuration save FOK isolation", () => {
  it.each([false, true])("fOK participant=%s saves even when GTC is unavailable and has manual holds", async (participant) => {
    const user = useUserStore(); user.extensionPrefs.pmGtcV1Participant = participant;
    user.extensionPrefs.pmGtcV1Activation = "1:12";
    mocks.refresh.mockRejectedValue(new Error("GTC unavailable"));
    await saveDialog();
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.info).toHaveBeenCalledOnce();
    expect(user.config.betting).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it.each([undefined, "1:foreign"])("unactivated GTC preference %s retains effective FOK saving", async (activation) => {
    const user = useUserStore(); user.extensionPrefs.pmArbOrderMode = "GTC";
    user.extensionPrefs.pmGtcV1Participant = true; user.extensionPrefs.pmGtcV1Activation = activation;
    await saveDialog(); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("activated GTC still requires manual review before enabling new groups", async () => {
    const user = useUserStore(); user.extensionPrefs.pmArbOrderMode = "GTC"; user.extensionPrefs.pmGtcV1Activation = "1:12";
    await saveDialog(); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.resume).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("unavailable activated GTC blocks only GTC saving", async () => {
    const user = useUserStore(); user.extensionPrefs.pmArbOrderMode = "GTC"; user.extensionPrefs.pmGtcV1Activation = "1:12";
    mocks.refresh.mockRejectedValue(new Error("GTC unavailable"));
    await saveDialog(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledWith("GTC unavailable");
  });
  it("turning off automatic betting never waits on GTC", async () => {
    const user = useUserStore(); user.config.betting = false; user.extensionPrefs.pmArbOrderMode = "GTC"; user.extensionPrefs.pmGtcV1Activation = "1:12";
    await saveDialog(); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
