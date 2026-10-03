import type { PodDropAlert } from "@/runtime/podAlerts";
import type { PodBetTicket } from "@/runtime/podBetTicket";
import type { PodBoardFixture } from "@/runtime/podFixtureMatch";
import { afterEach, describe, expect, it } from "vitest";
import { POD_BET_SETTINGS_DEFAULTS } from "@/runtime/podBetSettings";
import { matchPodAlertToFixtures, matchPodAlertToVenueFixtures } from "@/runtime/podFixtureMatch";
import {
  getPodVenueMatchPlugin,
  listPodVenueMatchPlugins,
  matchPodAlertAcrossVenuePlugins,
  registerPodVenueMatchPlugin,
  unregisterPodVenueMatchPluginForTests,
} from "@/runtime/podVenueMatchPlugins";
import { scorePodYaboFollow } from "@/runtime/podYabo";

const EXTRA_ID = "FutureVenue";

afterEach(() => unregisterPodVenueMatchPluginForTests(EXTRA_ID));

function alert(): PodDropAlert {
  return {
    id: "pod-1",
    eventId: "event-1",
    sport: "Football",
    sportId: 1,
    league: "Premier League",
    home: "Arsenal",
    away: "Chelsea",
    starts: 1_800_000_000_000,
    alertedAt: 1_799_999_999_000,
    market: "ML",
    lineType: "moneyline",
    outcome: "home",
    points: null,
    period: 0,
    previous: 2.1,
    current: 2,
    nvp: 2,
    dropPct: 5,
    ways: 2,
  };
}

function fixture(): PodBoardFixture {
  return {
    id: 1,
    title: "Arsenal vs Chelsea",
    game: "epl",
    startAt: 1_800_000_000_000,
    obMid: "ob-1",
    pmMid: "pm-1",
    homeName: "Arsenal",
    awayName: "Chelsea",
    markets: [],
  };
}

describe("pod venue match plugins", () => {
  it("keeps OB fixture matching byte-for-byte compatible with the existing matcher", () => {
    const fixtures = [fixture()];
    const legacy = matchPodAlertToFixtures(alert(), fixtures);
    const throughPlugin = getPodVenueMatchPlugin("OB").matchFixture(alert(), fixtures);
    expect(throughPlugin).toEqual(legacy);
  });

  it("keeps OB score, market, NVP and quote output identical to scorePodYaboFollow", () => {
    const settings = { ...POD_BET_SETTINGS_DEFAULTS, enabled: true };
    const ticket: PodBetTicket = {
      id: "pod-1",
      alert: alert(),
      kind: "moneyline",
      sideLabel: "主",
      marketLabel: "全场独赢",
      nvp: 2,
      pinCurrent: 2,
      pinPrevious: 2.1,
      minObOdds: 2,
      maxObOdds: 3,
      stake: 0,
      dropPct: 5,
      starts: alert().starts,
    };
    const board = {
      ...fixture(),
      markets: [{
        id: 11,
        marketCode: "moneyline",
        line: null,
        name: "全场独赢",
        ob: true,
        quoteHome: 2.1,
        quoteAway: 1.8,
        quoteDraw: 0,
        oidHome: "ob-home",
        oidAway: "ob-away",
        betIdHome: "ob-market",
        betIdAway: "ob-market",
      }],
    };
    const fixtures = [board];
    const fixtureMatch = matchPodAlertToFixtures(ticket.alert, fixtures);
    const hit = fixtureMatch.hits[0]!;
    const live = { get: () => 0, has: () => false };
    const legacy = scorePodYaboFollow(ticket, {
      fixture: hit.fixture,
      swapped: hit.swapped,
      live,
      books: [],
      settings,
    });
    const throughPlugin = getPodVenueMatchPlugin("OB").scoreTicket!(ticket, fixtureMatch, {
      fixtures,
      live,
      books: [],
      settings,
    });
    expect(throughPlugin).toEqual(legacy);
  });

  it("registers PM as a separate built-in plugin", () => {
    expect(listPodVenueMatchPlugins().map(row => row.id)).toEqual(["OB", "Polymarket", "RAY"]);
    expect(getPodVenueMatchPlugin("Polymarket").matchFixture(alert(), [fixture()]).status).toBe("matched");
  });

  it("confirms RAY independently of identical OB and PM fixtures", () => {
    const ray = { ...fixture(), id: 3, obMid: "", pmMid: undefined, providers: { RAY: "ray-1" } };
    const result = getPodVenueMatchPlugin("RAY").matchFixture(alert(), [fixture(), ray]);
    expect(result).toMatchObject({ status: "matched", basis: "confirmed" });
    expect(result.hits[0]?.fixture.id).toBe(3);
  });
  it("selects only RAY odds when an OB market has the same market code", () => {
    const ray = { ...fixture(), id: 3, obMid: "", pmMid: undefined, providers: { RAY: "ray-1" }, markets: [
      { id: 1, marketCode: "moneyline", line: null, name: "独赢", venue: "OB", ob: true, quoteHome: 9, quoteAway: 9, quoteDraw: 9, oidHome: "ob-odd" },
      { id: 2, marketCode: "moneyline", line: null, name: "独赢", venue: "RAY", ob: false, quoteHome: 2.1, quoteAway: 2, quoteDraw: 3, oidHome: "ray-odd" },
    ] };
    const plugin = getPodVenueMatchPlugin("RAY");
    const matched = plugin.matchMarket(alert(), plugin.matchFixture(alert(), [ray]), { has: () => true, get: () => 2.1 });
    expect(matched).toMatchObject({ status: "matched", venue: "RAY", oid: "ray-odd", quote: 2.1 });
  });

  it("confirms a PM-only fixture by pmMid without requiring OB", () => {
    const pmOnly = { ...fixture(), obMid: "", providers: { Polymarket: "pm-1" } };
    const result = getPodVenueMatchPlugin("Polymarket").matchFixture(alert(), [pmOnly]);
    expect(result.status).toBe("matched");
    expect(result.basis).toBe("confirmed");
  });

  it("isolates identical OB and PM rows instead of returning a cross-venue pending match", () => {
    const obOnly = { ...fixture(), pmMid: undefined, providers: { OB: "ob-1" } };
    const pmOnly = { ...fixture(), id: 2, obMid: "", providers: { Polymarket: "pm-1" } };
    const ob = getPodVenueMatchPlugin("OB").matchFixture(alert(), [obOnly, pmOnly]);
    const pm = getPodVenueMatchPlugin("Polymarket").matchFixture(alert(), [obOnly, pmOnly]);
    expect(ob).toMatchObject({ status: "matched", basis: "confirmed" });
    expect(pm).toMatchObject({ status: "matched", basis: "confirmed" });
    expect(ob.hits[0]?.fixture.id).toBe(1);
    expect(pm.hits[0]?.fixture.id).toBe(2);
  });

  it("allows a future venue without editing the POD panel", () => {
    const base = getPodVenueMatchPlugin("Polymarket");
    registerPodVenueMatchPlugin({
      ...base,
      id: EXTRA_ID,
      matchFixture: (drop, fixtures) => matchPodAlertToVenueFixtures(drop, fixtures, EXTRA_ID),
    });
    expect(getPodVenueMatchPlugin(EXTRA_ID).id).toBe(EXTRA_ID);
    const matched = matchPodAlertAcrossVenuePlugins(alert(), [{
      ...fixture(),
      providers: { OB: "ob-1", Polymarket: "pm-1", [EXTRA_ID]: "future-1" },
    }], { get: () => 0 });
    expect(matched.get(EXTRA_ID)?.fixture.status).toBe("matched");
  });
});
