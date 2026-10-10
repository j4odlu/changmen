import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { useUserStore } from "@/stores/userStore";
import Tab from "./UserDiagExtensionsTab.vue";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  save: vi.fn(),
  select: undefined as ((value: string) => void) | undefined,
}));

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/form/style/css", () => ({}));
vi.mock("element-plus/es/components/form-item/style/css", () => ({}));
vi.mock("element-plus/es/components/tooltip/style/css", () => ({}));
vi.mock("element-plus/es/components/input-number/style/css", () => ({}));
vi.mock("element-plus/es/components/switch/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-group/style/css", () => ({}));
vi.mock("element-plus/es/components/radio-button/style/css", () => ({}));

vi.mock("@/stores/userStore", async () => {
  const { defineStore } = await import("pinia");
  const { createDefaultExtensionPrefs } = await import("@/types/extensionPrefs");
  return {
    useUserStore: defineStore("extension-tab-test", {
      state: () => ({ userId: 12, extensionPrefs: createDefaultExtensionPrefs(), config: { makeUp: false } }),
      actions: { saveExtensionPrefs: mocks.save },
    }),
  };
});
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: { render: () => null } }));
vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: mocks.alert },
}));
vi.mock("element-plus/es", async () => {
  const { defineComponent, h } = await import("vue");
  const container = defineComponent({
    setup: (_props, { slots }) => () => h("div", [slots.label?.(), slots.default?.()]),
  });
  return {
    ElMessage: { success: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: mocks.alert },
    ElForm: container,
    ElFormItem: container,
    ElTooltip: container,
    ElInputNumber: container,
    ElSwitch: container,
    ElButton: defineComponent({ setup: (_props, { slots }) => () => h("button", slots.default?.()) }),
    ElRadioGroup: defineComponent({
      props: ["modelValue"],
      emits: ["update:modelValue", "change"],
      setup(_props, { emit, slots }) {
        mocks.select = (value: string) => {
          emit("update:modelValue", value);
          emit("change", value);
        };
        return () => h("div", slots.default?.());
      },
    }),
    ElRadioButton: defineComponent({
      props: ["value"],
      setup(props, { slots }) {
        return () => h("button", { "data-mode": props.value }, slots.default?.());
      },
    }),
  };
});

async function mount() {
  const html = await renderToString(createSSRApp(Tab));
  expect(html).toContain("data-mode=\"FOK\"");
  expect(html).toContain("data-mode=\"GTC\"");
  expect(html).toContain("FOK 沿用现有流程");
  return {
    select(mode: string) {
      expect(mocks.select).toBeDefined();
      mocks.select!(mode);
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.alert.mockReset().mockResolvedValue("confirm");
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.select = undefined;
});

describe("pm GTC V1 explicit activation in Extensions", () => {
  it("defaults to FOK and selecting FOK does not show a dialog or save", async () => {
    const tab = await mount();
    expect(useUserStore().extensionPrefs.pmArbOrderMode).toBe("FOK");
    tab.select("FOK");
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("requires confirmation and saves recovery marker before enabling real GTC", async () => {
    const tab = await mount();
    const user = useUserStore();
    const before = JSON.parse(JSON.stringify(user.extensionPrefs));
    tab.select("GTC");
    for (let n = 0; n < 8; n++) await Promise.resolve();
    expect(user.extensionPrefs).toEqual({ ...before, pmArbOrderMode: "GTC", pmGtcV1Activation: "1:12", pmGtcV1Participant: true });
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("确认保存并启用"),
      "启用真实 GTC V1",
      expect.objectContaining({ type: "warning" }),
    );
    expect(mocks.save).toHaveBeenCalledTimes(2);
    tab.select("FOK");
    expect(user.extensionPrefs).toEqual({ ...before, pmGtcV1Participant: true });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it("canceling activation leaves actual mode FOK without saving", async () => {
    mocks.alert.mockRejectedValueOnce("close");
    const tab = await mount();
    tab.select("GTC");
    await Promise.resolve();
    expect(useUserStore().extensionPrefs.pmArbOrderMode).toBe("FOK");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
