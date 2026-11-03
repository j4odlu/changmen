import type { ViewMatch } from "@changmen/client-core/models/match";
import { afterEach, expect, it, vi } from "vitest";
import * as Vue from "vue";
import { createRenderer, createSSRApp, h, nextTick, reactive, ssrContextKey, type Component, type VNode } from "vue";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { renderToString } from "vue/server-renderer";
import PmPriceTrend from "./PmPriceTrend.vue";
import trendSource from "./PmPriceTrend.vue?raw";
import { resolveTrendTarget } from "./target";

const bus = vi.hoisted(() => ({ receive: null as null | ((quote: { assetId: string; bestAsk: number }) => void), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  onPolymarketMarketQuote: (receive: NonNullable<typeof bus.receive>) => {
    bus.subscribe(); bus.receive = receive;
    return () => { bus.unsubscribe(); bus.receive = null; };
  },
}));

type Host = { tag: string; text: string; style: Record<string, string>; props: Record<string, unknown>; children: Host[]; parent: Host | null };
const node = (tag = ""): Host => ({ tag, text: "", style: {}, props: {}, children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: tag => node(tag), createText: text => ({ ...node(), text }), createComment: () => node(),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child); child.parent = parent;
  },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child); },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _old, value) { child.props[key] = value; },
  parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const apps: ReturnType<typeof renderer.createApp>[] = [];
const { descriptor } = parse(trendSource);
const { code } = compile(descriptor.template!.content, {
  mode: "function", prefixIdentifiers: true,
  bindingMetadata: compileScript(descriptor, { id: "pm-trend-test" }).bindings,
});
const clientTrend = { ...PmPriceTrend, render: new Function("Vue", code)(Vue) } as Component;
function text(host: Host): string { return host.text + host.children.map(text).join(""); }
function all(host: Host): Host[] { return [host, ...host.children.flatMap(all)]; }
function fixture() {
  return reactive({ id: 7, liveRound: 5, pmSport: { live: true, currentMap: 2 }, bets: [0, 1, 2, 3].map(round => ({
    id: round, round, homeName: "Alpha", awayName: "Beta",
    items: [{ type: "Polymarket", homeId: `h${round}`, awayId: `a${round}` }],
  })) } as unknown as ViewMatch);
}
function mount(match: ViewMatch) {
  const root = node(); const app = renderer.createApp({ render: (): VNode => h(clientTrend, { match }) });
  app.provide(ssrContextKey, {});
  apps.push(app); app.mount(root); return root;
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.clearAllMocks();
});

it("follows PM map state independently of OB without modifying the match or starting SSR resources", async () => {
  vi.useFakeTimers();
  const match = fixture(); const original = JSON.stringify(match);
  expect(resolveTrendTarget(match)?.round).toBe(2);
  const html = await renderToString(createSSRApp(PmPriceTrend, { match }));
  expect(html).toContain("地图2 · PM 走势"); expect(html).toContain("等待实时行情");
  expect(bus.subscribe).not.toHaveBeenCalled(); expect(JSON.stringify(match)).toBe(original);
  match.pmSport = { live: false, status: "scheduled", currentMap: 2 };
  expect(resolveTrendTarget(match)).toBeNull();
  match.pmSport = { live: true, currentMap: 2 };
  match.bets[2]!.marketCode = "total";
  expect(resolveTrendTarget(match)).toBeNull();
});

it("updates both raw prices once per second, changes map without mixing history, stops on finish and unmount", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const match = fixture(); const original = JSON.stringify(match);
  const root = mount(match);
  expect(bus.subscribe).toHaveBeenCalledTimes(1);
  bus.receive?.({ assetId: "h2", bestAsk: .4 }); bus.receive?.({ assetId: "a2", bestAsk: .65 });
  expect(text(root)).not.toContain("40.0¢");
  vi.advanceTimersByTime(1_000); await nextTick();
  expect(text(root)).toContain("Alpha 40.0¢"); expect(text(root)).toContain("Beta 65.0¢");
  expect(text(root)).toContain("买入价"); expect(JSON.stringify(match)).toBe(original);
  const svg = all(root).find(n => n.tag === "svg")!;
  (svg.props.onMousemove as (event: unknown) => void)({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 320 }) }, clientX: 308 });
  await nextTick();
  expect(text(root)).toContain("赔率 2.500"); expect(text(root)).toContain("赔率 1.538");
  vi.advanceTimersByTime(31_000); await nextTick(); expect(text(root)).toContain("等待更新");
  match.pmSport!.currentMap = 3; await nextTick();
  expect(text(root)).toContain("地图3 · PM 走势"); expect(text(root)).not.toContain("40.0¢");
  bus.receive?.({ assetId: "h2", bestAsk: .8 });
  bus.receive?.({ assetId: "h3", bestAsk: .3 });
  vi.advanceTimersByTime(1_000); await nextTick();
  expect(text(root)).toContain("30.0¢"); expect(text(root)).not.toContain("80.0¢");
  match.pmSport!.ended = true; await nextTick();
  expect(text(root)).toBe(""); expect(vi.getTimerCount()).toBe(0);
  match.pmSport = { live: true, currentMap: 1 }; await nextTick();
  expect(text(root)).toContain("地图1 · PM 走势"); expect(vi.getTimerCount()).toBe(1);
});
