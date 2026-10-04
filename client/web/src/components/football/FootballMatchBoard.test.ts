import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey, type Component } from "vue";
import type { ViewMatch } from "@/models/match";
import { podBoardFocus, requestPodBoardFocus } from "@/runtime/podBoardFocus";
import Board from "./FootballMatchBoard.vue";

vi.mock("element-plus/es/components/input/style/css", () => ({}));
vi.mock("element-plus/es/components/checkbox/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/base/style/css", () => ({}));

const mocks = vi.hoisted(() => ({
  football: vi.fn(), obLive: vi.fn(), live: vi.fn(), stop: vi.fn(), sync: vi.fn(),
  selectCell: vi.fn(),
  matchEl: { scrollIntoView: vi.fn() },
  cell: { scrollIntoView: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() } },
}));
vi.mock("@/stores/footballStore", () => ({ useFootballStore: mocks.football }));
vi.mock("@/stores/obSportLiveStore", () => ({ useObSportLiveStore: mocks.obLive }));
vi.mock("@/runtime/sportLiveOdds", () => ({ startSportLiveOddsSession: mocks.live }));
vi.mock("@/runtime/obSportFootballFetch", () => ({ listObFootballLivePatches: () => [] }));
vi.mock("@/runtime/podBoardFocus", async (original) => ({
  ...await original<typeof import("@/runtime/podBoardFocus")>(),
  selectPodBoardMatch: () => mocks.matchEl,
  selectPodBoardCell: mocks.selectCell,
}));
vi.mock("./FootballLazyBook.vue", () => ({ default: {} }));
vi.mock("./FootballMatchCard.vue", () => ({ default: {} }));

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});
const apps: ReturnType<typeof renderer.createApp>[] = [];
function row(id: number, venue: string): ViewMatch {
  return { id, title: "Home vs Away", game: "League", startAt: Date.now() + 60_000,
    providers: { [venue]: String(id) }, bets: [] } as unknown as ViewMatch;
}
type BoardState = {
  venueTab: string; searchQuery: string; leagueFilter: string; showLive: boolean;
  visibleMatchs: ViewMatch[]; venueTabs: { key: string; n: number }[];
  switchVenue: (venue: string) => Promise<void>; matchsEl: HTMLElement | null;
};
let store: { matchs: ViewMatch[]; startPolling: ReturnType<typeof vi.fn>; stopPolling: ReturnType<typeof vi.fn> };
function mount(): BoardState {
  const app = renderer.createApp({ render: () => h({ ...Board, render: () => h("div") } as Component) });
  app.provide(ssrContextKey, {});
  apps.push(app);
  const vm = app.mount(node());
  return (vm.$.subTree.component as unknown as { setupState: BoardState }).setupState;
}
beforeEach(() => {
  vi.clearAllMocks();
  podBoardFocus.value = null;
  store = reactive({ matchs: ref([row(1, "OB"), row(2, "Polymarket"), row(3, "RAY")]),
    loading: ref(false), refreshing: ref(false), error: ref(""),
    startPolling: vi.fn(), stopPolling: vi.fn(), fetchMatchs: vi.fn() });
  mocks.football.mockReturnValue(store);
  mocks.obLive.mockReturnValue(reactive({ listRev: ref(0), get: vi.fn(), applyLive: vi.fn() }));
  mocks.live.mockReturnValue({ stop: mocks.stop, sync: mocks.sync });
  mocks.selectCell.mockReturnValue(mocks.cell);
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  podBoardFocus.value = null;
  vi.unstubAllGlobals();
});

describe("football venue tabs", () => {
  it("filters the board while keeping the full store and all venue live subscriptions", async () => {
    const state = mount();
    const liveRows = mocks.live.mock.calls[0][0] as () => ViewMatch[];
    expect(state.venueTabs.map(tab => tab.n)).toEqual([3, 1, 1, 1]);
    for (const [venue, id] of [["OB", 1], ["Polymarket", 2], ["RAY", 3]] as const) {
      await state.switchVenue(venue);
      expect(state.visibleMatchs.map(m => m.id)).toEqual([id]);
      expect(liveRows().map(m => m.id)).toEqual([1, 2, 3]);
      expect(store.matchs).toHaveLength(3);
    }
    state.searchQuery = "missing";
    state.showLive = false;
    expect(state.visibleMatchs).toHaveLength(0);
    expect(liveRows()).toHaveLength(3);
    expect(store.startPolling).toHaveBeenCalledTimes(1);
    expect(store.stopPolling).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("restores each tab's filters and scroll position", async () => {
    const state = mount();
    const element = { scrollTop: 120, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    state.matchsEl = element as unknown as HTMLElement;
    await nextTick();
    state.searchQuery = "Home";
    await state.switchVenue("OB");
    expect(state.searchQuery).toBe("");
    expect(element.scrollTop).toBe(0);
    state.searchQuery = "Away";
    state.showLive = false;
    element.scrollTop = 250;
    await state.switchVenue("all");
    expect(state.searchQuery).toBe("Home");
    expect(element.scrollTop).toBe(120);
    await state.switchVenue("OB");
    expect(state.searchQuery).toBe("Away");
    expect(state.showLive).toBe(false);
    expect(element.scrollTop).toBe(250);
  });

  it("keeps searched far matches subscribed even when switching to another venue", async () => {
    const far = row(4, "OB");
    far.title = "Far Home vs Away";
    far.startAt = Date.now() + 8 * 3600_000;
    store.matchs.push(far);
    const state = mount();
    const liveRows = mocks.live.mock.calls[0][0] as () => ViewMatch[];
    expect(liveRows().map(m => m.id)).not.toContain(4);
    await state.switchVenue("OB");
    state.searchQuery = "Far";
    expect(state.visibleMatchs.map(m => m.id)).toEqual([4]);
    expect(liveRows().map(m => m.id)).toContain(4);
    await state.switchVenue("RAY");
    expect(liveRows().map(m => m.id)).toContain(4);
    expect(state.visibleMatchs.map(m => m.id)).toEqual([3]);
  });

  it("handles consecutive follow jumps sharing a timestamp", async () => {
    const state = mount();
    const focus = { marketCode: "", side: null, line: null, oid: "", token: 123 };
    podBoardFocus.value = { ...focus, matchId: 1, obMid: "1" };
    for (let i = 0; i < 6; i++) await nextTick();
    expect(state.venueTab).toBe("OB");
    podBoardFocus.value = { ...focus, matchId: 3, obMid: "" };
    for (let i = 0; i < 6; i++) await nextTick();
    expect(state.venueTab).toBe("RAY");
  });

  it("cancels an old follow highlight when switching venue during lazy loading", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return 1; });
    mocks.selectCell.mockReturnValue(null);
    const state = mount();
    requestPodBoardFocus({ matchId: 1, obMid: "1", marketCode: "spreads", side: null, line: -0.5, oid: "oid" });
    for (let i = 0; i < 6; i++) await nextTick();
    expect(frames).toHaveLength(1);
    await state.switchVenue("RAY");
    mocks.selectCell.mockReturnValue(mocks.cell);
    frames.shift()!(0);
    for (let i = 0; i < 6; i++) await nextTick();
    expect(state.venueTab).toBe("RAY");
    expect(mocks.cell.classList.add).not.toHaveBeenCalled();
    expect(mocks.cell.scrollIntoView).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it("switches to the followed match's venue and does not pin it in other venue tabs", async () => {
    const state = mount();
    await state.switchVenue("RAY");
    requestPodBoardFocus({ matchId: 1, obMid: "1", marketCode: "", side: null, line: null, oid: "" });
    for (let i = 0; i < 6; i++) await nextTick();
    expect(state.venueTab).toBe("OB");
    expect(mocks.matchEl.scrollIntoView).toHaveBeenCalled();
    await state.switchVenue("Polymarket");
    expect(state.visibleMatchs.map(m => m.id)).toEqual([2]);
    for (const [venue, id] of [["Polymarket", 2], ["RAY", 3]] as const) {
      requestPodBoardFocus({ matchId: id, obMid: "", marketCode: "", side: null, line: null, oid: "" });
      for (let i = 0; i < 6; i++) await nextTick();
      expect(state.venueTab).toBe(venue);
      expect(state.visibleMatchs.map(m => m.id)).toEqual([id]);
    }
  });
});
