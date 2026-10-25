import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveComposeEndPatch } from "../compose/compose_once.js";
import { ALL_SOURCES_GONE_MS } from "../compose/shape/ended_filter.js";

describe("M1 resolveComposeEndPatch", () => {
  it("ends a PM-confirmed active gap without changing its original platform links", () => {
    const now = Date.now();
    const row = { id: 8673, start_time: now - 3600000, round: 1,
      matchs: { OB: "ob1", Polymarket: "pm1" }, pm_sport: { ended: true, eventId: "pm1" } };
    const original = structuredClone(row);
    const patch = resolveComposeEndPatch({ previousActiveIds: [8673], clientRows: [row],
      platformMatches: { Polymarket: { pm1: { SourceMatchID: "pm1" } } }, now });
    assert.deepEqual(patch, { markEndedIds: [8673], activeGaps: [] });
    assert.deepEqual(row, original);
  });
  it("does not markEnded when previous active drops out of info (sources still live)", () => {
    const now = Date.now();
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [1669, 100],
      info: [{ ID: 100 }],
      endedRows: [],
      clientRows: [{
        id: 1669,
        start_time: now - ALL_SOURCES_GONE_MS - 60_000,
        matchs: { OB: "ob1", RAY: "ray1" },
      }],
      platformMatches: {
        OB: { ob1: { SourceMatchID: "ob1" } },
        RAY: { ray1: { SourceMatchID: "ray1" } },
      },
      now,
    });
    assert.deepEqual(markEndedIds, []);
    assert.deepEqual(activeGaps, [1669]);
  });

  it("gaps exclude ids already in endedRows", () => {
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [1, 2, 3],
      info: [{ ID: 1 }],
      endedRows: [{ ID: 2 }],
    });
    assert.deepEqual(markEndedIds, []);
    assert.deepEqual(activeGaps, [3]);
  });

  it("no gaps when all previous actives are in info or ended", () => {
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [1, 2],
      info: [{ ID: 1 }],
      endedRows: [{ ID: 2 }],
    });
    assert.deepEqual(markEndedIds, []);
    assert.deepEqual(activeGaps, []);
  });

  it("sources-gone gap past time gate → markEndedIds (zombie root fix)", () => {
    const now = Date.now();
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [2008, 100],
      info: [{ ID: 100 }],
      endedRows: [],
      clientRows: [{
        id: 2008,
        title: "LeeK NXT vs PURE Academy",
        start_time: now - ALL_SOURCES_GONE_MS - 60_000,
        matchs: { OB: "gone-ob", RAY: "gone-ray" },
      }],
      platformMatches: {
        OB: { other: { SourceMatchID: "other" } },
        RAY: {},
      },
      now,
    });
    assert.deepEqual(markEndedIds, [2008]);
    assert.deepEqual(activeGaps, []);
  });

  it("sources-gone but start still within grace → activeGaps only", () => {
    const now = Date.now();
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [9],
      info: [],
      endedRows: [],
      clientRows: [{
        id: 9,
        start_time: now - 30_000,
        matchs: { OB: "gone" },
      }],
      platformMatches: {},
      now,
    });
    assert.deepEqual(markEndedIds, []);
    assert.deepEqual(activeGaps, [9]);
  });

  it("without platformMatches keeps M1: gaps never markEnded", () => {
    const { markEndedIds, activeGaps } = resolveComposeEndPatch({
      previousActiveIds: [1669],
      info: [],
      endedRows: [],
      clientRows: [{
        id: 1669,
        start_time: Date.now() - 3600_000,
        matchs: { OB: "x" },
      }],
    });
    assert.deepEqual(markEndedIds, []);
    assert.deepEqual(activeGaps, [1669]);
  });
});
