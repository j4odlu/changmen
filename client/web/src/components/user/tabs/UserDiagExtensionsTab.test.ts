import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPmFokPreflightMode } from "@changmen/venue-browser/adapter/polymarket/pmFokPreflightMode";
import { PM_BOOK_KEYS, readPmBookSettings } from "@/runtime/pmBookSettings";
import { createSSRApp } from "vue";
import { useUserStore } from "@/stores/userStore";
import Tab from "./UserDiagExtensionsTab.vue";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  buttons: new Map<string, () => Promise<void>>(),
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
    ElButton: defineComponent({ setup: (_props, { slots, attrs }) => () => {
      const children = slots.default?.();
      const label = children?.map(child => String(child.children)).join("").trim() ?? "";
      if (attrs.onClick) mocks.buttons.set(label, attrs.onClick as () => Promise<void>);
      return h("button", children);
    } }),
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

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.alert.mockReset().mockResolvedValue("confirm");
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.buttons.clear();
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

describe("PM arbitrage retirement and preflight settings", () => {
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
    expect(user.extensionPrefs).not.toHaveProperty("pmArbOrderMode");
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });


  it("does not render automatic PM order mode selection or a migration panel", async () => {
    const html = await renderToString(createSSRApp(Tab));
    expect(html).not.toContain("PM 自动套利"); expect(html).not.toContain('data-mode="GTC"');
    expect(html).not.toContain("使用 FOK 并保存"); expect(html).not.toContain("当前模式：FOK");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("legacy preferences cannot restore the removed mode controls", async () => {
    const user = useUserStore();
    Object.assign(user.extensionPrefs, { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:12", pmGtcV1Participant: true });
    const html = await renderToString(createSSRApp(Tab));
    expect(html).not.toContain("PM 自动套利"); expect(html).not.toContain("使用 FOK 并保存");
    expect(user.extensionPrefs.pmGtcV1Participant).toBe(true); expect(mocks.alert).not.toHaveBeenCalled();
  });
  it("renders LOS with a separate, default-off C filter and concise rules", async () => {
    const user = useUserStore();
    expect(user.extensionPrefs.arbExecutionMode).toBe("normal");
    const normal = await renderToString(createSSRApp(Tab));
    expect(normal).toContain("LOS");
    expect(normal).not.toContain("仅下 C 行高胜率方");
    expect(user.extensionPrefs.lowOddsSingleHigherCProbabilityOnly).toBe(false);
    user.extensionPrefs.arbExecutionMode = "lowOddsSingle";
    const html = await renderToString(createSSRApp(Tab));
    expect(html).toContain("Low Odds Single");
    expect(html).not.toContain("低赔单边");
    expect(html).toContain("每盘口 1 次");
    expect(html).toContain("不补单");
    expect(html).toContain("更多规则");
    expect(html).toContain("低赔腿与 C 行高胜率方向一致才提交，否则跳过");
    expect(mocks.switches.get("LOS 仅下C行高胜率方")).toMatchObject({ disabled: false, value: false });
    expect(html).toContain("不跨设备共享");
    expect(html).toContain('data-mode="normal"');
    expect(html).toContain('data-mode="lowOddsSingle"');
    expect(user.extensionPrefs).not.toHaveProperty("pmArbOrderMode");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("places all four unchanged 9999 settings directly below hedge mode without changing saved preferences", async () => {
    const user = useUserStore();
    user.extensionPrefs.singleLeg9999Precheck = false;
    user.extensionPrefs.singleLeg9999UseValueBetMoney = true;
    user.extensionPrefs.singleLeg9999HigherCProbabilityOnly = true;
    user.extensionPrefs.singleLeg9999MaxPerMap = 3;
    const before = JSON.stringify(user.extensionPrefs);
    const html = await renderToString(createSSRApp(Tab));
    expect(html).toContain('aria-label="对冲下注模式"');
    expect(html).not.toContain("自动下注模式");
    const mode = html.indexOf("对冲下注模式");
    const settings = html.indexOf('aria-label="9999 单边配置"');
    const venues = html.indexOf("场馆参与");
    expect(settings).toBeGreaterThan(mode);
    expect(settings).toBeLessThan(venues);
    for (const label of ["9999 单边预检", "9999 用正EV金额", "9999 仅下C行高胜率方", "9999 同图次数"])
      expect(html.split(label)).toHaveLength(2);
    expect(JSON.stringify(user.extensionPrefs)).toBe(before);
    expect(mocks.save).not.toHaveBeenCalled();
  });

});
