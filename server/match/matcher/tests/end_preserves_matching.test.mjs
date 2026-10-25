import { describe, expect, it } from "vitest";
import { composeFromSnapshot, runEndPass, runMatchPass } from "../compose/pipeline.js";
import { matchingPlatformSources } from "../lib/match_lifecycle.js";
import { installPlugin, pmOb, pmRay } from "./fixtures.mjs";

function fixture(endedAt = 123) {
  const row = { id: 42, title: "Ninjas in Pyjamas vs K27", merge_key: "match:id:3:100631:100297",
    start_time: pmOb.StartTime, ended_at: endedAt, matchs: { OB: "ob1", RAY: "ray1", Polymarket: "pm1" } };
  const matches = { OB: { ob1: { ...pmOb, ClientMatchId: 42 } }, RAY: { ray1: { ...pmRay, ClientMatchId: 42 } } };
  return { matches, clientRows: [row], alignClientRows: [row], timers: {}, bets: {} };
}

describe("ending changes status while preserving matching", () => {
  it("does not recompose residual OB and RAY sources after a manual end without PM status", () => {
    installPlugin();
    const snapshot = fixture();
    const original = structuredClone(snapshot);
    const { list } = composeFromSnapshot(snapshot);
    expect(list).toEqual([]);
    expect(snapshot).toEqual(original);
    expect(runMatchPass(list, snapshot).info).toEqual([]);
  });

  it("remembers ended source IDs even if old reverse pointers were already cleared", () => {
    installPlugin();
    const snapshot = fixture();
    delete snapshot.matches.OB.ob1.ClientMatchId;
    delete snapshot.matches.RAY.ray1.ClientMatchId;
    expect(composeFromSnapshot(snapshot).list).toEqual([]);
  });

  it("allows new source IDs for the same teams, and preserves the ended match links", () => {
    installPlugin();
    const snapshot = fixture();
    snapshot.matches.OB.nextOb = { ...pmOb, SourceMatchID: "nextOb", StartTime: pmOb.StartTime + 86400000 };
    snapshot.matches.RAY.nextRay = { ...pmRay, SourceMatchID: "nextRay", StartTime: pmRay.StartTime + 86400000 };
    const { list } = composeFromSnapshot(snapshot);
    expect(list).toHaveLength(1);
    expect(list[0].Matchs).toEqual({ OB: "nextOb", RAY: "nextRay" });
    expect(snapshot.matches.OB.ob1.ClientMatchId).toBe(42);
  });

  it("restoring the original record makes its sources eligible without rebuilding ownership", () => {
    const snapshot = fixture();
    expect(matchingPlatformSources(snapshot.matches, snapshot.clientRows).OB).toEqual({});
    snapshot.clientRows[0].ended_at = null;
    expect(matchingPlatformSources(snapshot.matches, snapshot.clientRows).OB.ob1.ClientMatchId).toBe(42);
  });

  it("restoring a match is not blocked by a duplicate ended record with the same sources", () => {
    installPlugin();
    const snapshot = fixture(null);
    snapshot.clientRows.unshift({ ...snapshot.clientRows[0], id: 41, ended_at: 123 });
    snapshot.alignClientRows = snapshot.clientRows;
    expect(matchingPlatformSources(snapshot.matches, snapshot.clientRows).OB.ob1.ClientMatchId).toBe(42);
    expect(composeFromSnapshot(snapshot).list[0].ID).toBe(42);
    delete snapshot.matches.OB.ob1.ClientMatchId;
    expect(matchingPlatformSources(snapshot.matches, snapshot.clientRows).OB.ob1.SourceMatchID).toBe("ob1");
  });

  it("honors stored PM completion even when the current candidate lost its PM source", () => {
    const now = Date.now();
    const snapshot = fixture(null);
    snapshot.clientRows[0].start_time = now - 3600000;
    snapshot.clientRows[0].pm_sport = { eventId: "pm1", status: "finished" };
    const info = [{ ID: 42, StartTime: now - 3600000, Round: 1, Matchs: { OB: "ob1", RAY: "ray1" } }];
    const end = runEndPass(info, snapshot);
    expect(end.info).toEqual([]);
    expect(end.endedRows.map(row => row.ID)).toEqual([42]);
  });
});
