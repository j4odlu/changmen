import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  filterActiveClientMatches,
  isClientMatchEnded,
  buildEndedPmSportByPolymarketLink,
  buildEndedSourceTombstones,
} from "../compose/shape/ended_filter.js";
import { filterMultiPlatform } from "../compose/shape/live_shape.js";

describe("ended_filter + multi platform", () => {
  it("drops ended when all sources gone after start", () => {
    const now = Date.now();
    const row = {
      ID: 1,
      StartTime: now - 10 * 60 * 1000,
      Round: 0,
      Matchs: { OB: "gone", RAY: "gone2" },
      Bets: [],
    };
    assert.equal(isClientMatchEnded(row, {}, {}, now), true);
  });

  it("keeps live Round>0", () => {
    const now = Date.now();
    const row = {
      ID: 2,
      StartTime: now - 60_000,
      Round: 1,
      Matchs: { OB: "ob1" },
      Bets: [{ Map: 0, Sources: { OB: { Status: "Normal" } } }],
    };
    assert.equal(
      isClientMatchEnded(row, { OB: { ob1: { SourceMatchID: "ob1", IsLive: 2 } } }, {}, now),
      false,
    );
  });

  it("filterActiveClientMatches removes ended only", () => {
    const now = Date.now();
    const { list, endedList, endedCount } = filterActiveClientMatches([
      {
        ID: 1,
        StartTime: now - 10 * 60 * 1000,
        Round: 0,
        Matchs: { OB: "x" },
        Bets: [],
      },
      {
        ID: 2,
        StartTime: now + 60_000,
        Round: 0,
        Matchs: { OB: "ob1", RAY: "ray1" },
        Bets: [],
      },
    ], { platformMatches: {}, now });
    assert.equal(endedCount, 1);
    assert.equal(list.length, 1);
    assert.equal(list[0].ID, 2);
    assert.equal(endedList.length, 1);
    assert.equal(endedList[0].ID, 1);
  });

  it("sticky ended_at keeps row ended even if still looks live", () => {
    const now = Date.now();
    const row = {
      ID: 9,
      StartTime: now + 60_000,
      Round: 1,
      Matchs: { OB: "ob1", RAY: "ray1" },
      Bets: [{ Map: 0, Sources: { OB: { Status: "Normal" } } }],
    };
    const matches = {
      OB: { ob1: { SourceMatchID: "ob1", IsLive: 2 } },
      RAY: { ray1: { SourceMatchID: "ray1" } },
    };
    const { list, endedList, endedCount } = filterActiveClientMatches([row], {
      platformMatches: matches,
      endedAtByClientId: new Map([[9, now - 1000]]),
      now,
    });
    assert.equal(endedCount, 1);
    assert.equal(list.length, 0);
    assert.equal(endedList[0].ID, 9);
  });

  it("filterMultiPlatform after strip", () => {
    const kept = filterMultiPlatform([
      { Matchs: { OB: "1", RAY: "2" } },
      { Matchs: { OB: "1" } },
      { Matchs: {} },
    ]);
    assert.equal(kept.length, 1);
  });

  it("filterMultiPlatform keeps live single-platform rows", () => {
    const kept = filterMultiPlatform([
      { Matchs: { OB: "1" }, Round: 1 },
      { Matchs: { OB: "2" }, Round: 0 },
      { Matchs: {}, Round: 2 },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].Matchs.OB, "1");
  });

  it("PM confirms the whole match ended even if OB still reports live", () => {
    const now = Date.now();
    const row = {
      ID: 3,
      StartTime: now - 3600_000,
      Round: 0,
      Matchs: { OB: "ob1", Polymarket: "pm1" },
      Bets: [{ Map: 1, Sources: { OB: { Status: "Locked" } } }],
    };
    const matches = { OB: { ob1: { SourceMatchID: "ob1", IsLive: 1 } } };
    assert.equal(
      isClientMatchEnded(row, matches, {}, now, { slug: "pm1", ended: true, status: "finished" }),
      true,
    );
    assert.equal(
      isClientMatchEnded(row, matches, {}, now, { slug: "pm1", ended: false, status: "running" }),
      false,
    );
    assert.equal(
      isClientMatchEnded(
        row,
        { OB: { ob1: { SourceMatchID: "ob1", IsLive: 2 } } },
        {},
        now,
        { slug: "pm1", ended: true, status: "finished" },
      ),
      true,
    );
    assert.equal(isClientMatchEnded({ ...row, Round: 1 }, matches,
      { OB: { timer: [{ MatchID: "ob1", Round: 1 }] } }, now,
      { eventId: "pm1", ended: true }), true);
    assert.equal(isClientMatchEnded(row, matches, {}, now,
      { eventId: "another-event", ended: true }), false);
    assert.equal(isClientMatchEnded({ ...row, StartTime: now + 60000 }, matches, {}, now,
      { eventId: "pm1", ended: true }), false);
  });

  it("inherits ended pm_sport by Polymarket link when active row has null pm_sport", () => {
    const now = Date.now();
    const row = {
      ID: 1855,
      StartTime: now - 4 * 3600 * 1000,
      Round: 0,
      Matchs: { Polymarket: "831247", PredictFun: "300365" },
      Bets: [],
    };
    const platformMatches = {
      Polymarket: { "831247": { SourceMatchID: "831247" } },
      PredictFun: { "300365": { SourceMatchID: "300365" } },
    };
    assert.equal(isClientMatchEnded(row, platformMatches, {}, now, null), false);
    const inherited = { ended: true, status: "finished", eventId: "831247", _endedAt: now - 3600_000 };
    const { list, endedCount } = filterActiveClientMatches([row], {
      platformMatches,
      endedPmSportByPolymarketLink: new Map([["831247", inherited]]),
      now,
    });
    assert.equal(endedCount, 1);
    assert.equal(list.length, 0);
  });

  it("buildEndedPmSportByPolymarketLink indexes confirmed ended history", () => {
    const map = buildEndedPmSportByPolymarketLink([
      {
        id: 1808,
        ended_at: 1000,
        matchs: { Polymarket: "831247", PredictFun: "300365" },
        pm_sport: { ended: true, eventId: "831247", status: "finished" },
      },
      {
        id: 1855,
        ended_at: null,
        matchs: { Polymarket: "831247" },
        pm_sport: null,
      },
    ]);
    assert.equal(map.get("831247")?.ended, true);
    const tombs = buildEndedSourceTombstones([
      {
        id: 1808,
        ended_at: 1000,
        matchs: { Polymarket: "831247", PredictFun: "300365" },
        pm_sport: { ended: true, eventId: "831247" },
      },
    ]);
    assert.equal(tombs.has("Polymarket:831247"), true);
    assert.equal(tombs.has("PredictFun:300365"), true);
  });
});
