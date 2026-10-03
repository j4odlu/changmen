/**
 * POD 足球场馆匹配插件层。
 * 只编排现有足球匹配函数；不进入电竞 matcher / mainBetLoop / fo。
 */
import type { PodBookLine, PodDropAlert } from "@/runtime/podAlerts";
import type { PodBetSettings } from "@/runtime/podBetSettings";
import type { PodBetTicket } from "@/runtime/podBetTicket";
import type { PodBoardFixture, PodFixtureMatch } from "@/runtime/podFixtureMatch";
import type { PodLiveOddsReader, PodMarketMatch, PodObQuoteCompare } from "@/runtime/podMarketMatch";
import type { PodYaboFollowScore } from "@/runtime/podYabo";
import { matchPodAlertToFixtures, matchPodAlertToVenueFixtures } from "@/runtime/podFixtureMatch";
import { comparePodVenueQuote, matchPodAlertToVenueMarket } from "@/runtime/podMarketMatch";
import { scorePodYaboFollow } from "@/runtime/podYabo";

export interface PodVenueMatchContext {
  fixtures: PodBoardFixture[];
  live: PodLiveOddsReader;
  books: PodBookLine[];
  settings: PodBetSettings;
}

export interface PodVenueMarketContext {
  minOdds: number;
  maxOdds?: number;
  nvp?: number;
}

export interface PodVenueMatchPlugin {
  id: string;
  matchFixture: (alert: PodDropAlert, fixtures: PodBoardFixture[]) => PodFixtureMatch;
  matchMarket: (
    alert: PodDropAlert,
    fixtureMatch: PodFixtureMatch,
    live: PodLiveOddsReader,
  ) => PodMarketMatch;
  compareQuote: (match: PodMarketMatch, ctx: PodVenueMarketContext) => PodObQuoteCompare;
  /** OB 兼容入口：必须继续委托现有 scorePodYaboFollow，保持当前副盘/NVP 行为。 */
  scoreTicket?: (ticket: PodBetTicket, fixtureMatch: PodFixtureMatch, ctx: PodVenueMatchContext) => PodYaboFollowScore;
}

export interface PodVenueMatchResult {
  plugin: PodVenueMatchPlugin;
  fixture: PodFixtureMatch;
  market: PodMarketMatch;
}

const plugins = new Map<string, PodVenueMatchPlugin>();

export function registerPodVenueMatchPlugin(plugin: PodVenueMatchPlugin, replace = false): void {
  const id = String(plugin?.id || "").trim();
  if (!id)
    throw new Error("POD venue plugin id is required");
  if (!replace && plugins.has(id))
    throw new Error(`POD venue plugin already registered: ${id}`);
  plugins.set(id, plugin);
}

export function getPodVenueMatchPlugin(id: string): PodVenueMatchPlugin {
  const plugin = plugins.get(String(id || "").trim());
  if (!plugin)
    throw new Error(`POD venue plugin not registered: ${id}`);
  return plugin;
}

export function listPodVenueMatchPlugins(): PodVenueMatchPlugin[] {
  return [...plugins.values()];
}

/** 对所有已注册场馆运行独立对场/对盘；新增场馆无需修改 POD 匹配循环。 */
export function matchPodAlertAcrossVenuePlugins(
  alert: PodDropAlert,
  fixtures: PodBoardFixture[],
  live: PodLiveOddsReader,
): Map<string, PodVenueMatchResult> {
  return new Map(listPodVenueMatchPlugins().map((plugin) => {
    const fixture = plugin.matchFixture(alert, fixtures);
    return [plugin.id, {
      plugin,
      fixture,
      market: plugin.matchMarket(alert, fixture, live),
    }];
  }));
}

function firstHit(match: PodFixtureMatch) {
  return match.status === "matched" ? match.hits[0] : null;
}

const obPlugin: PodVenueMatchPlugin = {
  id: "OB",
  matchFixture(alert, fixtures) {
    return matchPodAlertToFixtures(alert, fixtures.filter(row => Boolean(row.obMid || row.providers?.OB)));
  },
  matchMarket(alert, fixtureMatch, live) {
    const hit = firstHit(fixtureMatch);
    return matchPodAlertToVenueMarket(
      alert,
      hit?.fixture,
      "OB",
      hit?.swapped === true,
      live,
    );
  },
  compareQuote(match, ctx) {
    return comparePodVenueQuote(match, "OB", ctx.minOdds, {
      maxObOdds: ctx.maxOdds,
      nvp: ctx.nvp,
    });
  },
  scoreTicket(ticket, fixtureMatch, ctx) {
    const hit = firstHit(fixtureMatch);
    return scorePodYaboFollow(ticket, {
      fixture: hit?.fixture,
      swapped: hit?.swapped === true,
      live: ctx.live,
      books: ctx.books,
      settings: ctx.settings,
    });
  },
};

function venuePlugin(id: string): PodVenueMatchPlugin {
  return {
    id,
    matchFixture(alert, fixtures) {
      return matchPodAlertToVenueFixtures(alert, fixtures, id);
    },
    matchMarket(alert, fixtureMatch, live) {
      const hit = firstHit(fixtureMatch);
      return matchPodAlertToVenueMarket(
        alert,
        hit?.fixture,
        id,
        hit?.swapped === true,
        live,
      );
    },
    compareQuote(match, ctx) {
      return comparePodVenueQuote(match, id, ctx.minOdds, {
        maxObOdds: ctx.maxOdds,
        nvp: ctx.nvp,
      });
    },
  };
}

registerPodVenueMatchPlugin(obPlugin);
registerPodVenueMatchPlugin(venuePlugin("Polymarket"));
registerPodVenueMatchPlugin(venuePlugin("RAY"));

/** Test-only cleanup; built-in plugins cannot be removed. */
export function unregisterPodVenueMatchPluginForTests(id: string): void {
  if (id === "OB" || id === "Polymarket" || id === "RAY")
    return;
  plugins.delete(id);
}
