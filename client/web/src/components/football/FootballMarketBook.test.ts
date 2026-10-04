import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, reactive, ssrContextKey, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { ViewMatch } from "@/models/match";
import type { ClientMatchDto } from "@/types/esport";
import type { FootballObMarketRow } from "@/runtime/footballObMarkets";
import { useObSportLiveStore } from "@/stores/obSportLiveStore";
import Book from "./FootballMarketBook.vue";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/footballObMarkets", () => ({
  loadFootballObMarkets: load,
  peekFootballObMarkets: () => undefined,
  isFootballObMarketsComplete: () => false,
  invalidateFootballObMarkets: vi.fn(),
}));
vi.mock("@/components/football/FootballMarketSection.vue", () => ({ default: {} }));

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

function match(venue = "OB", withMarkets = true) {
  return new ViewMatch({
    ID: 1, Title: "Home vs Away", Game: "football", GameID: 0,
    StartTime: Date.now(), Matchs: { OB: "5505659" },
    Bets: withMarkets ? [{
      ID: 1, MatchID: 1, Map: 0, Name: "让球", MarketCode: "spreads", Line: -0.5,
      Sources: { [venue]: {
        Type: venue, BetID: "b1", HomeID: "h1", AwayID: "a1",
        HomeOdds: 0, AwayOdds: 0, Status: "Locked",
      } },
    }] : [],
  } as unknown as ClientMatchDto);
}

function mount(initial: ViewMatch) {
  const props = reactive({ match: initial });
  const component = { ...Book, render: () => h("div") } as Component;
  const app = renderer.createApp({ render: () => h(component, props) });
  app.provide(ssrContextKey, {});
  apps.push(app);
  const vm = app.mount(node());
  const state = (vm.$.subTree.component as unknown as {
    setupState: { loading: boolean; error: string; obRows: FootballObMarketRow[] };
  }).setupState;
  return { props, state };
}

beforeEach(() => {
  setActivePinia(createPinia());
  load.mockReset().mockResolvedValue([]);
});
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); });

describe("football book list-first rendering", () => {
  it("does not fetch on mount or play updates when the OB list already has structure, even if locked", async () => {
    const { props } = mount(match());
    await nextTick();
    useObSportLiveStore().playRevByMid["5505659"] = 1;
    props.match = match();
    await nextTick();
    expect(load).not.toHaveBeenCalled();
  });

  it("fetches a fallback when only another venue has list markets", async () => {
    mount(match("Polymarket"));
    await nextTick();
    expect(load).toHaveBeenCalledWith("5505659", false);
  });

  it("ignores an in-flight fallback once fresh OB list markets arrive", async () => {
    let finish!: (rows: FootballObMarketRow[]) => void;
    load.mockReturnValueOnce(new Promise<FootballObMarketRow[]>(resolve => { finish = resolve; }));
    const { props, state } = mount(match("OB", false));
    expect(load).toHaveBeenCalledTimes(1);
    props.match = match();
    await nextTick();
    finish([{ MarketCode: "spreads", Line: -1, Selections: [{ OddID: "stale", Odds: 9 }] }]);
    await nextTick();
    expect(state.loading).toBe(false);
    expect(state.obRows).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    // A later missing snapshot must not reuse the stale in-flight result.
    props.match = match("OB", false);
    await nextTick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("accepts a slow fallback despite repeated play notifications instead of staying in loading", async () => {
    let finish!: (rows: FootballObMarketRow[]) => void;
    let finishRefresh!: (rows: FootballObMarketRow[]) => void;
    load.mockReturnValueOnce(new Promise<FootballObMarketRow[]>(resolve => { finish = resolve; }));
    load.mockReturnValueOnce(new Promise<FootballObMarketRow[]>(resolve => { finishRefresh = resolve; }));
    const { state } = mount(match("OB", false));
    expect(state.loading).toBe(true);
    for (let rev = 1; rev <= 3; rev++) {
      useObSportLiveStore().playRevByMid["5505659"] = rev;
      await nextTick();
    }
    expect(load).toHaveBeenCalledTimes(1);
    const rows: FootballObMarketRow[] = [{ MarketCode: "spreads", Line: -1, Selections: [{ OddID: "current", Odds: 1.95 }] }];
    finish(rows);
    await nextTick();
    expect(state.loading).toBe(false);
    expect(state.obRows).toEqual(rows);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("5505659", true);
    finishRefresh(rows);
    await nextTick();
    // A later play notification still refreshes the completed snapshot.
    useObSportLiveStore().playRevByMid["5505659"] = 4;
    await nextTick();
    expect(load).toHaveBeenLastCalledWith("5505659", true);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("shows a failed fallback and clears loading even when play notifications arrive during the request", async () => {
    let fail!: (err: Error) => void;
    load.mockReturnValueOnce(new Promise<FootballObMarketRow[]>((_resolve, reject) => { fail = reject; }));
    load.mockRejectedValueOnce(new Error("盘口请求超时"));
    const { state } = mount(match("OB", false));
    useObSportLiveStore().playRevByMid["5505659"] = 1;
    await nextTick();
    fail(new Error("盘口请求超时"));
    await nextTick();
    await nextTick();
    expect(state.loading).toBe(false);
    expect(state.error).toBe("盘口请求超时");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
