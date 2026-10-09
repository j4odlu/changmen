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
      state: () => ({ extensionPrefs: createDefaultExtensionPrefs(), config: { makeUp: false } }),
      actions: { saveExtensionPrefs: mocks.save },
    }),
  };
});
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: { render: () => null } }));
vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { alert: mocks.alert },
}));
vi.mock("element-plus/es", async () => {
  const { defineComponent, h } = await import("vue");
  const container = defineComponent({
    setup: (_props, { slots }) => () => h("div", [slots.label?.(), slots.default?.()]),
  });
  return {
    ElMessage: { success: vi.fn(), error: vi.fn() },
    ElMessageBox: { alert: mocks.alert },
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
  expect(html).toContain("当前两种选择均沿用现有 FOK 下单流程");
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

describe("pm mode placeholder in Extensions", () => {
  it("defaults to FOK and selecting FOK does not show a dialog or save", async () => {
    const tab = await mount();
    expect(useUserStore().extensionPrefs.pmArbOrderMode).toBe("FOK");
    tab.select("FOK");
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("selects GTC through the rendered control and warns without changing other settings", async () => {
    const tab = await mount();
    const user = useUserStore();
    const before = JSON.parse(JSON.stringify(user.extensionPrefs));
    tab.select("GTC");
    await Promise.resolve();
    expect(user.extensionPrefs).toEqual({ ...before, pmArbOrderMode: "GTC" });
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("GTC 为测试版本，尚未接入"),
      "GTC 测试版本",
      expect.objectContaining({ type: "warning" }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    tab.select("FOK");
    expect(user.extensionPrefs).toEqual(before);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it("closing the GTC warning preserves the preference without saving or throwing", async () => {
    mocks.alert.mockRejectedValueOnce("close");
    const tab = await mount();
    tab.select("GTC");
    await Promise.resolve();
    expect(useUserStore().extensionPrefs.pmArbOrderMode).toBe("GTC");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
