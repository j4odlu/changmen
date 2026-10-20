import { describe, expect, it } from "vitest";
import {
  assignMatchIds,
  findLinkedClientIdFromMatchs,
  findReuseIdByMatchsSuperset,
  findReuseIdByPlatformOverlap,
  matchsIsSubset,
  resolveClientMatchIds,
} from "../ids/client_match_ids.js";
import { stableBetId } from "../teams/match_utils.js";

describe("client_match_ids", () => {
  it("detects when existing matchs are a subset of rebuilt matchs", () => {
    const existing = { RAY: "1", IA: "2" };
    const built = { OB: "9", RAY: "1", IA: "2" };
    expect(matchsIsSubset(existing, built)).toBe(true);
    expect(matchsIsSubset(built, existing)).toBe(false);
  });

  it("reuses the id of the largest matching subset row", () => {
    const existingRows = [
      { id: 302, matchs: { RAY: "1", IA: "2" } },
      { id: 999, matchs: { RAY: "1" } },
    ];
    const built = { OB: "9", RAY: "1", IA: "2" };
    expect(findReuseIdByMatchsSuperset(existingRows, built)).toBe(302);
  });

  it("reuses id when platform rows already link to client_matches", () => {
    const matches = {
      OB: {
        ob1: { SourceMatchID: "ob1", ClientMatchId: 308 },
      },
      RAY: {
        ray1: { SourceMatchID: "ray1", ClientMatchId: 308 },
      },
    };
    const built = { OB: "ob1", RAY: "ray1" };
    expect(findLinkedClientIdFromMatchs(built, matches)).toBe(308);
  });

  it("reuses id on any platform:sourceId overlap with existing client row", () => {
    const existingRows = [{ id: 308, matchs: { RAY: "ray1", IA: "ia1" } }];
    const built = { RAY: "ray1", IA: "ia1" };
    expect(findReuseIdByPlatformOverlap(existingRows, built)).toBe(308);
  });

  it("reuses client row id when platform overlap matches across rebuilds", () => {
    const existingRows = [{ id: 42, matchs: { OB: "ob1", RAY: "ray1" } }];
    const built = { OB: "ob1", RAY: "ray1" };
    expect(findReuseIdByPlatformOverlap(existingRows, built)).toBe(42);
  });

  it("assignMatchIds uses stableBetId per map", () => {
    const row = {
      ID: 0,
      Bets: [{ Map: 0, Name: "full" }, { Map: 2, Name: "map2" }],
    };
    const out = assignMatchIds(row, 308);
    expect(out.ID).toBe(308);
    expect(out.Bets[0].ID).toBe(stableBetId(308, 0));
    expect(out.Bets[1].ID).toBe(stableBetId(308, 2));
    expect(out.Bets[0].MatchID).toBe(308);
  });

  it("findLinkedClientIdFromMatchs prefers existingIdKeyIndex on conflict", () => {
    const matches = {
      OB: { ob1: { SourceMatchID: "ob1", ClientMatchId: 100 } },
      RAY: { ray1: { SourceMatchID: "ray1", ClientMatchId: 200 } },
    };
    const built = { OB: "ob1", RAY: "ray1" };
    const mergeKey = "match:id:3:100301:100302";
    const index = new Map([[mergeKey, 200]]);
    expect(
      findLinkedClientIdFromMatchs(built, matches, { mergeKey, existingIdKeyIndex: index }),
    ).toBe(200);
  });

  it("resolveClientMatchIds reuses id by match:id merge key before insert", async () => {
    const mergeKey = "match:id:3:100301:100302";
    const adapter = {
      async fetchClientMatchIndex() {
        return [
          {
            id: 501,
            merge_key: "match:name:3:team a:team b",
            matchs: { OB: "ob1" },
          },
        ];
      },
      async insertClientMatchStub() {
        throw new Error("should not insert");
      },
      findClientMatchIdByMergeKey: async () => null,
    };
    const existingIdKeyIndex = new Map([[mergeKey, 501]]);
    const rows = [
      {
        MergeKey: mergeKey,
        Title: "A vs B",
        Game: "CS2",
        GameID: "3",
        StartTime: 1,
        BO: 3,
        Matchs: { OB: "ob1", RAY: "ray1" },
        Bets: [{ Map: 0, Name: "full" }],
      },
    ];
    const out = await resolveClientMatchIds(adapter, rows, { existingIdKeyIndex });
    expect(out[0].ID).toBe(501);
  });

  it("findLinkedClientIdFromMatchs returns 0 on conflict without resolvable index", () => {
    const matches = {
      OB: { ob1: { SourceMatchID: "ob1", ClientMatchId: 100 } },
      RAY: { ray1: { SourceMatchID: "ray1", ClientMatchId: 200 } },
    };
    const built = { OB: "ob1", RAY: "ray1" };
    expect(findLinkedClientIdFromMatchs(built, matches)).toBe(0);
    expect(
      findLinkedClientIdFromMatchs(built, matches, {
        mergeKey: "match:name:8:a:b",
        existingIdKeyIndex: new Map(),
      }),
    ).toBe(0);
  });

  it("resolveClientMatchIds does not reuse ended id via stale platform link (M3)", async () => {
    const mergeKey = "match:id:3:100601:101107";
    let inserted = 0;
    const adapter = {
      async fetchClientMatchIndex() {
        // fetch index is active-only (ended excluded upstream)
        return [];
      },
      async insertClientMatchStub(key) {
        expect(key).toBe(mergeKey);
        inserted += 1;
        return 9001;
      },
      findClientMatchIdByMergeKey: async () => null,
    };
    const matches = {
      OB: { newob: { SourceMatchID: "newob", ClientMatchId: 1459 } },
      Polymarket: { newpm: { SourceMatchID: "newpm", match_id: 1459 } },
    };
    const rows = [{
      MergeKey: mergeKey,
      Title: "Metanoia Wolves vs MEIA NOITE",
      Game: "CS2",
      GameID: "3",
      StartTime: 1,
      BO: 3,
      Matchs: { OB: "newob", Polymarket: "newpm" },
      Bets: [],
    }];
    const out = await resolveClientMatchIds(adapter, rows, { matches });
    expect(out[0].ID).toBe(9001);
    expect(inserted).toBe(1);
  });
});
