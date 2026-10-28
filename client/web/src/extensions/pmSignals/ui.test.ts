import type { ViewMatch } from "@/models/match";
import type { PmUpSignal } from "./upDetector";
import type { BrowserPmOddsDropSignal } from "./downSettings";
import { renderToString } from "@vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, createSSRApp, h, nextTick, reactive, ssrContextKey } from "vue";
import { createDefaultPmOddsDropSettings } from "./downSettings";
import { createDefaultPmUpPrefs } from "./upSettings";
import OddsSignalBadges from "./OddsSignalBadges.vue";
import { buildOddsSignalBadges } from "./oddsBadges";
import { filterSignals, presentDropSignal, presentUpSignal } from "./presentation";
import SignalCard from "./SignalCard.vue";
import SignalList from "./SignalList.vue";
import { useSignalSettings } from "./useSignalSettings";
import { useSignalMonitors } from "./useSignalMonitors";

const mocks = vi.hoisted(() => ({ user: null as any, start: vi.fn(), stop: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({ matchs: [] }) }));
vi.mock("./records", async () => {
  const { shallowRef } = await import("vue");
  const upSignals = shallowRef<PmUpSignal[]>([]);
  const downSignals = shallowRef<BrowserPmOddsDropSignal[]>([]);
  return {
    pmUpSignals: upSignals, clearPmUpSignals: () => { upSignals.value = []; },
    pmOddsDropSignals: downSignals, clearPmOddsDropSignals: () => { downSignals.value = []; },
  };
});
vi.mock("./runtime", () => ({ startPmSignalMonitor: (...args: unknown[]) => { mocks.start(...args); return mocks.stop; } }));
const { pmOddsDropSignals, pmUpSignals } = await import("./records");
const { allSignals, clearAllSignals } = await import("./state");
const up: PmUpSignal = {
  key: "market", id: "signal", assetId: "pm-a", matchId: 11, betId: 101,
  matchTitle: "Alpha vs Beta", marketTitle: "地图1 获胜",
  pmSide: "Home", pmSideLabel: "Alpha", targetSide: "Away", targetSideLabel: "Beta",
  beforeOdds: 1.8, pmOdds: 2.2, risePct: 22.222, baselineAt: 1000, detectedAt: 2000,
  target: { provider: "OB", itemId: "ob-b", odds: 2 }, arbPct: 4.7619,
};
const down: BrowserPmOddsDropSignal = {
  id: "signal", assetId: "pm-a", referenceVenue: "Polymarket", sourceMode: "official",
  beforeBestAsk: 0.4, currentBestAsk: 0.5, beforeOdds: 2.5, currentOdds: 2,
  dropPct: 20, windowMs: 1000, baselineAt: 1000, detectedAt: 2000, selection: null,
  venueSnapshot: { matchId: 11, betId: 101, matchTitle: "Alpha vs Beta", marketTitle: "地图1 获胜", side: "Home", sideLabel: "Alpha",
    referenceVenue: "Polymarket", pm: { odds: 2, evPercent: 0 }, ob: { odds: 2.2, evPercent: 10 }, ray: { odds: 2.1, evPercent: 5 }, pb: null },
};
const textOnly = (html: string) => html.replace(/<[^>]*>/g, "");

beforeEach(() => {
  mocks.user = reactive({ userId: "owner", extensionPrefs: reactive({ pmOddsDropCardUi: true, pmUpCardUi: true, pmDown: createDefaultPmOddsDropSettings(), pmUp: { ...createDefaultPmUpPrefs(), enabled: true } }) });
});
afterEach(() => { clearAllSignals(); vi.clearAllMocks(); });

describe("unified odds signal presentation", () => {
  it("keeps the PM side and opposite venue side explicit with distinct price and arbitrage percentages", async () => {
    const html = await renderToString(createSSRApp(SignalCard, { signal: presentUpSignal(up), now: 3000 }));
    const text = textOnly(html);
    expect(text).toContain("↑ 涨赔 · 对侧套利");
    expect(text).toContain("PMAlpha");
    expect(text).toContain("1.800→2.200");
    expect(text).toContain("↑ 22.22%");
    expect(text).toContain("另一侧搭配OBBeta@ 2.000");
    expect(text).toContain("理论套利+4.76%");
    expect(text).toContain("1秒前 · 快照");
    expect(html).toContain("定位比赛");
    const away = textOnly(await renderToString(createSSRApp(SignalCard, {
      signal: presentUpSignal({ ...up, pmSide: "Away", pmSideLabel: "Beta", targetSide: "Home", targetSideLabel: "Alpha" }), now: 3000,
    })));
    expect(away).toContain("PMBeta");
    expect(away).toContain("另一侧搭配OBAlpha");
  });

  it("shows the best same-side quote and labels its ratio as price difference rather than arbitrage or EV", async () => {
    const html = await renderToString(createSSRApp(SignalCard, { signal: presentDropSignal(down), now: 3000 }));
    const text = textOnly(html);
    expect(text).toContain("↓ 降赔 · 同向比价");
    expect(text).toContain("同方向最高报价OBAlpha@ 2.200");
    expect(text).toContain("同向价差+10.00%");
    expect(text).not.toMatch(/理论套利|EV/);
    expect(text).toContain("RAY · Alpha");
  });

  it("never fills a missing historical quote snapshot with current comparison prices", () => {
    const row = presentDropSignal({ ...down, venueSnapshot: null }, down.venueSnapshot);
    expect(row.matchId).toBe(11);
    expect(row.quotes).toEqual([]);
    expect(row.currentOdds).toBe(2);
  });

  it("merges chronological history with collision-safe IDs and filters by direction", async () => {
    pmUpSignals.value = [{ ...up, detectedAt: 4000 }];
    pmOddsDropSignals.value = [down];
    expect(allSignals.value.map(row => row.id)).toEqual(["up:signal", "down:signal"]);
    expect(filterSignals(allSignals.value, "down").map(row => row.id)).toEqual(["down:signal"]);
    const html = await renderToString(createSSRApp(SignalList, { signals: allSignals.value, now: 5000 }));
    expect(html).toContain('aria-label="筛选赔率异动方向"');
    expect(textOnly(html).indexOf("↑ 涨赔 · 对侧套利")).toBeLessThan(textOnly(html).indexOf("↓ 降赔 · 同向比价"));
    clearAllSignals();
    expect(allSignals.value).toEqual([]);
  });

  it("renders short right-side badges with an accessible historical explanation and ages their appearance", async () => {
    const match = { id: 11, bets: [] } as unknown as ViewMatch;
    const bet = { id: 101, items: [{ type: "Polymarket", homeId: "pm-a", awayId: "pm-b" }] } as any;
    const badges = buildOddsSignalBadges(match, bet, [], [up], 3000, { down: false, up: true }).get("Polymarket:Home:pm-a")!;
    const html = await renderToString(createSSRApp(OddsSignalBadges, { badges, now: 13000 }));
    expect(textOnly(html)).toContain("↑22.2%");
    expect(textOnly(html)).toContain("2.2001.800");
    expect(html).not.toContain("pm-odds-badge__phase");
    expect(html).toContain("is-aging");
    expect(html).toContain("PM涨赔 22.22%");
    expect(html).toContain("触发快照");
    expect(html).toContain("理论套利 +4.76%");
  });
});

describe("unified monitor ownership", () => {
  it("shares settings edits between consumers without changing display preferences", () => {
    const editor = useSignalSettings();
    const monitor = useSignalSettings();
    editor.updateUpSettings({ windowMs: 2500 });
    editor.updateDownSettings({ cooldownMs: 0, referenceVenue: "RAY" });
    expect(monitor.upSettings.value.windowMs).toBe(2500);
    expect(monitor.downSettings.value).toMatchObject({ cooldownMs: 0, referenceVenue: "RAY" });
    expect(mocks.user.extensionPrefs.pmUpCardUi).toBe(true);
    expect(mocks.user.extensionPrefs.pmOddsDropCardUi).toBe(true);
  });
  it("owns one monitor per user without restarting it on branch settings changes and clears history on logout", async () => {
    mocks.user.extensionPrefs.pmDown.enabled = true;
    const renderer = createRenderer<any, any>({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
    });
    const app = renderer.createApp({ setup() { useSignalMonitors(); return () => h("div"); } });
    app.provide(ssrContextKey, {});
    app.mount({});
    try {
      expect(mocks.start).toHaveBeenCalledTimes(1);
      const readSettings = mocks.start.mock.calls[0]![0];
      pmUpSignals.value = [up];
      pmOddsDropSignals.value = [down];
      mocks.user.extensionPrefs.pmUp.minArbPct = 2;
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(readSettings().up.minArbPct).toBe(2);
      expect(pmOddsDropSignals.value).toHaveLength(1);
      mocks.user.extensionPrefs.pmUpCardUi = false;
      mocks.user.extensionPrefs.pmOddsDropCardUi = false;
      await nextTick();
      expect(readSettings().up.enabled).toBe(true);
      expect(readSettings().down.enabled).toBe(true);
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.stop).not.toHaveBeenCalled();
      expect(pmUpSignals.value).toHaveLength(1);
      mocks.user.userId = "other";
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      expect(allSignals.value).toEqual([]);
      mocks.user.extensionPrefs.pmUp.enabled = false;
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      mocks.user.userId = "";
      await nextTick();
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(mocks.stop).toHaveBeenCalledTimes(2);
    } finally { app.unmount(); }
    expect(allSignals.value).toEqual([]);
  });
});
