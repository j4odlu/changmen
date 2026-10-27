import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { dedupeRowsById, mergeMatchs, scoreRowRichness } from "../compose/ids/dedupe_rows.ts";

describe("dedupeRowsById", () => {
  it("merges binding stub + auto cluster same ID", () => {
    const { list, mergedCount } = dedupeRowsById([
      {
        ID: 100,
        Matchs: { OB: "ob1" },
        Title: "",
        Bets: [],
        _clusterBasis: "binding",
      },
      {
        ID: 100,
        Matchs: { OB: "ob1", RAY: "ray1" },
        Title: "NiP vs K27",
        Bets: [{ Map: 0, Sources: { OB: { HomeID: "1" }, RAY: { HomeID: "2" } } }],
        _clusterBasis: "id",
      },
    ]);
    assert.equal(mergedCount, 1);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].Matchs, { OB: "ob1", RAY: "ray1" });
    assert.equal(list[0].Title, "NiP vs K27");
    assert.equal(Object.keys(list[0].Bets[0].Sources).length, 2);
  });

  it("keeps negative temp ids separate", () => {
    const { list, mergedCount } = dedupeRowsById([
      { ID: -1, Matchs: { OB: "a", RAY: "b" } },
      { ID: -2, Matchs: { OB: "c", RAY: "d" } },
    ]);
    assert.equal(mergedCount, 0);
    assert.equal(list.length, 2);
  });

  it("uses the later row on equal richness and preserves the first slot and winning object", () => {
    const first = { ID: 1, Matchs: { OB: "same" }, Title: "first", _basis: "binding" };
    const unrelated = { ID: 2 };
    const later = { ID: "1", Matchs: { OB: "same" }, Title: "later", _basis: "auto" };
    const result = dedupeRowsById([first, unrelated, later]);
    assert.deepEqual(result, { list: [later, unrelated], mergedCount: 1, conflicts: 0 });
    assert.equal(result.list[0], later);
    assert.equal(result.list[1], unrelated);
    assert.equal(first.Title, "first");
    assert.equal(later._basis, "auto");
  });

  it("counts all source keys and weights platform count before ordinary source richness", () => {
    const fewerPlatforms = { ID: 1, Matchs: { OB: "ob" }, Bets: [{ Sources: { OB: {}, RAY: {} } }, { Sources: { OB: {} } }] };
    const morePlatforms = { ID: 1, Matchs: { OB: "ob", RAY: "ray" }, Bets: [] };
    assert.equal(scoreRowRichness(fewerPlatforms), 1003);
    assert.equal(scoreRowRichness(morePlatforms), 2000);
    assert.equal(scoreRowRichness(null), 0);
    assert.equal(dedupeRowsById([morePlatforms, fewerPlatforms]).list[0], morePlatforms);
    assert.deepEqual(morePlatforms.Bets, []);
  });

  it("merges into the richer original row and fills only missing metadata", () => {
    const poorer = {
      ID: 8, Matchs: { OB: "ob" }, Bets: [], MergeKey: "key", Title: "Alpha vs Beta",
      StartTime: "1800000000", BO: "3", HomeGbTeamId: "h", AwayGbTeamId: "a", extra: "poorer",
    };
    const richer = {
      ID: 8, Matchs: { OB: "ob", RAY: "ray" }, Bets: [], MergeKey: "", Title: "  ",
      StartTime: 0, BO: 0, HomeGbTeamId: null, AwayGbTeamId: "", extra: "richer",
    };
    const result = dedupeRowsById([poorer, richer]);
    assert.equal(result.list[0], richer);
    assert.deepEqual(richer, {
      ...poorer, Matchs: { OB: "ob", RAY: "ray" }, extra: "richer",
    });
    assert.deepEqual(poorer.Matchs, { OB: "ob" });
    const stable = { ...richer, Matchs: { ...richer.Matchs }, Title: "existing", BO: 5, StartTime: 1800000200, HomeGbTeamId: 3, AwayGbTeamId: 4 };
    dedupeRowsById([poorer, stable]);
    assert.equal(stable.Title, "existing");
    assert.equal(stable.StartTime, 1800000200);
    assert.equal(stable.BO, 5);
    assert.equal(stable.HomeGbTeamId, 3);
    assert.equal(stable.AwayGbTeamId, 4);
  });

  it("merges three duplicates in their original slot, counts conflicts, and preserves richer IDs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const a = { ID: 1, Matchs: { OB: "old" } };
      const b = { ID: "1", Matchs: { OB: "new", RAY: "ray" } };
      const c = { ID: 1, Matchs: { OB: "last" } };
      const second = { ID: 2 };
      const result = dedupeRowsById([a, second, b, c]);
      assert.equal(result.list[0], b);
      assert.equal(result.list[1], second);
      assert.equal(result.mergedCount, 2);
      assert.equal(result.conflicts, 2);
      assert.deepEqual(b.Matchs, { OB: "new", RAY: "ray" });
      assert.equal(warn.mock.calls.length, 2);
      assert.match(warn.mock.calls[0][0], /dedupe #1 OB sourceId 冲突: old vs new/);
    }
    finally {
      warn.mockRestore();
    }
  });

  it("keeps invalid or nonpositive IDs separate and filters empty input rows", () => {
    const rows = [{ ID: 0 }, { ID: 0 }, { ID: -1 }, { ID: -1 }, { ID: "bad" }, { ID: "bad" }, {}];
    assert.deepEqual(dedupeRowsById([null, ...rows, undefined]), {
      list: rows, mergedCount: 0, conflicts: 0,
    });
    assert.deepEqual(dedupeRowsById(null), { list: [], mergedCount: 0, conflicts: 0 });
    assert.deepEqual(dedupeRowsById(undefined), { list: [], mergedCount: 0, conflicts: 0 });
  });
});

describe("mergeMatchs", () => {
  it("compares IDs as strings and reports conflicts even when retaining side a", () => {
    const conflicts = [];
    const a = { OB: 1, RAY: "old", empty: "", missing: null, zero: 0 };
    const b = { OB: "1", RAY: "new", empty: "filled", missing: "filled", zero: "new" };
    const result = mergeMatchs(a, b, {
      prefer: "a", onConflict: (...args) => conflicts.push(args),
    });
    assert.deepEqual(conflicts, [["RAY", "old", "new"], ["zero", 0, "new"]]);
    assert.deepEqual(result, { OB: "1", RAY: "old", empty: "filled", missing: "filled", zero: 0 });
    assert.equal(a.empty, "");
    assert.notEqual(result, a);
    assert.deepEqual(mergeMatchs(null, null), {});
    assert.deepEqual(mergeMatchs(), {});
  });
});
