import type { PmUpSignal } from "./detector";
import { renderToString } from "@vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, createSSRApp, h, nextTick, reactive, ssrContextKey } from "vue";
import { createDefaultPmUpPrefs } from "./settings";
import PmUpSignals from "./PmUpSignals.vue";
import MatchPmUpSignals from "./MatchPmUpSignals.vue";
import PmUpPanel from "./PmUpPanel.vue";

const mocks = vi.hoisted(() => ({ user: null as any, start: vi.fn(), stop: vi.fn() }));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({ matchs: [] }) }));
vi.mock("./runtime", async () => {
  const { shallowRef } = await import("vue");
  const signals = shallowRef<PmUpSignal[]>([]);
  return {
    pmUpSignals: signals,
    clearPmUpSignals: () => { signals.value = []; },
    startPmUpMonitor: (...args: unknown[]) => { mocks.start(...args); return mocks.stop; },
  };
});
const { pmUpSignals } = await import("./runtime");

const signal: PmUpSignal = {
  key: "market", id: "signal", assetId: "pm-a", matchId: 11, betId: 101,
  matchTitle: "Alpha vs Beta", marketTitle: "地图1 获胜",
  pmSide: "Home", pmSideLabel: "Alpha", targetSide: "Away", targetSideLabel: "Beta",
  beforeOdds: 1.8, pmOdds: 2.2, risePct: 22.222, baselineAt: 1_000, detectedAt: 2_000,
  target: { provider: "OB", itemId: "ob-b", odds: 2 }, arbPct: 4.7619,
};

afterEach(() => { pmUpSignals.value = []; vi.clearAllMocks(); });

describe("pm_up signal presentation and lifecycle", () => {
  it("shows PM rising side separately from the venue opposite side and labels historical quotes", async () => {
    const html = await renderToString(createSSRApp(PmUpSignals, { signals: [signal], showMatch: true }));
    expect(html).toContain("Alpha vs Beta");
    expect(html).toContain("关注 OB · Beta @2.000");
    expect(html.replace(/<[^>]*>/g, "")).toContain("PM Alpha 1.800 → 2.200");
    expect(html).toContain("套利 +4.76%");
    expect(html).toContain("触发快照");
  });

  it("shows history only on the matching match and market", async () => {
    pmUpSignals.value = [signal];
    const matching = await renderToString(createSSRApp(MatchPmUpSignals, { matchId: 11, betId: 101 }));
    const otherMap = await renderToString(createSSRApp(MatchPmUpSignals, { matchId: 11, betId: 102 }));
    const otherMatch = await renderToString(createSSRApp(MatchPmUpSignals, { matchId: 12, betId: 101 }));
    expect(matching).toContain("关注 OB");
    expect(otherMap).not.toContain("关注 OB");
    expect(otherMatch).not.toContain("关注 OB");
  });

  it("restarts on settings or owner changes and stops when disabled or unmounted", async () => {
    mocks.user = reactive({ userId: "owner", extensionPrefs: { pmUp: { ...createDefaultPmUpPrefs(), enabled: true } } });
    const renderer = createRenderer<any, any>({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
      parentNode: () => null, nextSibling: () => null,
    });
    const app = renderer.createApp({ render: () => h({ ...PmUpPanel, render: () => h("div") }) });
    app.provide(ssrContextKey, {});
    app.mount({});
    try {
      expect(mocks.start).toHaveBeenCalledTimes(1);
      pmUpSignals.value = [signal];
      mocks.user.extensionPrefs.pmUp.minArbPct = 2;
      await nextTick();
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(pmUpSignals.value).toEqual([]);
      mocks.user.userId = "other";
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(3);
      mocks.user.extensionPrefs.pmUp.enabled = false;
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(3);
      expect(mocks.stop).toHaveBeenCalledTimes(3);
    }
    finally { app.unmount(); }
    expect(pmUpSignals.value).toEqual([]);
  });
});
