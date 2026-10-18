import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPmFokPreflightMode } from "@changmen/venue-adapter/polymarket/pmFokPreflightMode";
import { PM_BOOK_KEYS, readPmBookSettings } from "@/runtime/pmBookSettings";
import { createSSRApp } from "vue";
import { useUserStore } from "@/stores/userStore";
import Tab from "./UserDiagExtensionsTab.vue";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  save: vi.fn(),
  select: undefined as ((value: string) => void) | undefined,
  selectPreflight: undefined as ((value: string) => void) | undefined,
  switches: new Map<string, { disabled: boolean; value: boolean; change: (value: boolean) => void }>(),
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
    ElSwitch: defineComponent({
      props: ["modelValue", "disabled"], emits: ["change"],
      setup(props, { attrs, emit }) {
        if (attrs["aria-label"]) mocks.switches.set(String(attrs["aria-label"]), {
          disabled: !!props.disabled, value: !!props.modelValue, change: value => emit("change", value),
        });
        return () => h("span");
      },
    }),
    ElButton: defineComponent({ setup: (_props, { slots }) => () => h("button", slots.default?.()) }),
    ElRadioGroup: defineComponent({
      props: ["modelValue"],
      emits: ["update:modelValue", "change"],
      setup(props, { emit, slots }) {
        const select = (value: string) => {
          emit("update:modelValue", value);
          emit("change", value);
        };
        if (props.modelValue === "FOK" || props.modelValue === "GTC") mocks.select = select;
        else mocks.selectPreflight = select;
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
  mocks.selectPreflight = undefined;
  mocks.switches.clear();
  setPmFokPreflightMode("legacy");
  for (const key of Object.values(PM_BOOK_KEYS)) localStorage.removeItem(key);
});
afterEach(() => {
  setPmFokPreflightMode("legacy");
  for (const key of Object.values(PM_BOOK_KEYS)) localStorage.removeItem(key);
});

describe("pm GTC V1 explicit activation in Extensions", () => {
  it("keeps local observation switches off and disabled for saved classic despite an unsaved dynamic form", async () => {
    useUserStore().extensionPrefs.pmFokPreflightMode = "optimized";
    const html = await renderToString(createSSRApp(Tab));
    expect(html).toContain("实际预检仍走 HTTP"); expect(html).toContain("仅当前浏览器、当前站点生效");
    expect(mocks.switches.get("本地订单簿")).toMatchObject({ disabled: true, value: false });
    expect(mocks.switches.get("动态预检对照")).toMatchObject({ disabled: true, value: false });
    mocks.switches.get("本地订单簿")!.change(true);
    expect(readPmBookSettings().localBook).toBe(false);
  });
  it("saves browser switches immediately without saving account preferences and permits rollback in classic", async () => {
    setPmFokPreflightMode("optimized");
    await renderToString(createSSRApp(Tab));
    mocks.switches.get("本地订单簿")!.change(true);
    expect(readPmBookSettings().localBook).toBe(true);
    await renderToString(createSSRApp(Tab));
    expect(mocks.switches.get("动态预检对照")!.disabled).toBe(false);
    mocks.switches.get("动态预检对照")!.change(true);
    expect(readPmBookSettings().shadow).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    setPmFokPreflightMode("legacy"); await renderToString(createSSRApp(Tab));
    expect(mocks.switches.get("本地订单簿")!.disabled).toBe(false);
    mocks.switches.get("本地订单簿")!.change(false);
    expect(readPmBookSettings()).toEqual({ localBook: false, shadow: true });
    mocks.switches.get("动态预检对照")!.change(false);
    expect(readPmBookSettings().shadow).toBe(false);
    expect(useUserStore().extensionPrefs.pmFokPreflightMode).toBe("legacy");
  });
  it("renders independent preflight settings and edits the preference without activating GTC", async () => {
    const html = await renderToString(createSSRApp(Tab));
    expect(html).toContain("经典预检（默认）");
    expect(html).toContain("动态复核预检");
    expect(html).toContain('aria-label="预检方式"');
    expect(html).toContain("动态复核预检设置");
    expect(html).not.toContain("PM FOK 预检方式");
    const user = useUserStore();
    expect(user.extensionPrefs.pmFokPreflightMode).toBe("legacy");
    mocks.selectPreflight!("optimized");
    expect(user.extensionPrefs.pmFokPreflightMode).toBe("optimized");
    expect(user.extensionPrefs.pmArbOrderMode).toBe("FOK");
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
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
