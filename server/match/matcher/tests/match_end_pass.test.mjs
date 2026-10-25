import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  runEndPass,
  runMatchPass,
} from "../compose/pipeline.js";
import { matchingPlatformSources } from "../lib/match_lifecycle.js";
import { ALL_SOURCES_GONE_MS } from "../compose/shape/ended_filter.js";

describe("M2 runMatchPass / runEndPass", () => {
  it("ended sources leave matching candidates while their links remain intact", () => {
    const matches = {
      OB: { ob1: { SourceMatchID: "ob1", ClientMatchId: 1459, match_id: 1459 } },
      RAY: { ray1: { SourceMatchID: "ray1", ClientMatchId: 88 } },
    };
    const eligible = matchingPlatformSources(matches, [
      { id: 1459, ended_at: 1 },
      { id: 88, ended_at: null },
    ]);
    assert.deepEqual(eligible.OB, {});
    assert.equal(matches.OB.ob1.ClientMatchId, 1459);
    assert.equal(matches.OB.ob1.match_id, 1459);
    assert.equal(eligible.RAY.ray1.ClientMatchId, 88);
    assert.equal(matches.RAY.ray1.ClientMatchId, 88);
  });
  it("runEndPass splits ended without changing match clustering inputs", () => {
    const now = Date.now();
    const live = {
      ID: 1,
      StartTime: now + 60_000,
      Round: 0,
      Matchs: { OB: "ob1", RAY: "ray1" },
      Bets: [],
    };
    const dead = {
      ID: 2,
      StartTime: now - ALL_SOURCES_GONE_MS - 60_000,
      Round: 0,
      Matchs: { OB: "gone", RAY: "gone2" },
      Bets: [],
    };
    const end = runEndPass([live, dead], {
      matches: {},
      timers: {},
      clientRows: [],
    });
    assert.equal(end.endedCount, 1);
    assert.equal(end.info.length, 1);
    assert.equal(end.info[0].ID, 1);
    assert.equal(end.endedRows[0].ID, 2);
  });

  it("runMatchPass returns processedActiveIds before end filter", () => {
    const snapshot = {
      matches: {
        OB: {
          ob1: {
            SourceMatchID: "ob1",
            Home: "A",
            Away: "B",
            HomeID: "1",
            AwayID: "2",
            StartTime: Date.now() + 3_600_000,
            SourceGameID: "1",
            IsLive: 0,
          },
        },
        RAY: {
          ray1: {
            SourceMatchID: "ray1",
            Home: "A",
            Away: "B",
            HomeID: "10",
            AwayID: "20",
            StartTime: Date.now() + 3_600_000,
            SourceGameID: "1",
            IsLive: 0,
          },
        },
      },
      bets: {},
      timers: {},
      clientRows: [],
      alignClientRows: [],
      platformOverrides: {},
    };
    // Minimal cluster-shaped rows (already merged)
    const list = [{
      Matchs: { OB: "ob1", RAY: "ray1" },
      Title: "A vs B",
      StartTime: Date.now() + 3_600_000,
      Game: "csgo",
      GameID: "1",
      BO: 3,
      Round: 0,
      RoundStart: 0,
      Reverse: [],
      Bets: [],
      MergeKey: "test:a:b",
      ID: 42,
    }];
    const match = runMatchPass(list, snapshot, { fromVenuesOnly: true });
    assert.ok(match.processedActiveIds instanceof Set);
    assert.ok(typeof match.preEndedCount === "number");
    assert.ok(Array.isArray(match.info));
  });
});
