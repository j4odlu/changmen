import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  findReuseIdByPlatformOverlap,
  matchsSignature,
} from "@changmen/match-identity/ids/client_match_ids.js";
import { clientMatchWriteRow } from "../compose/write_payload.js";
import { resolveIdsDryRun } from "../compose/ids/resolve_ids.js";

describe("ended lifecycle identity reuse", () => {
  it("clientMatchWriteRow carries ended_at for ended writes", () => {
    const row = clientMatchWriteRow({
      ID: 42,
      Title: "A vs B",
      Game: "csgo",
      GameID: "1",
      StartTime: 1000,
      BO: 3,
      Round: 0,
      RoundStart: 0,
      Reverse: [],
      Matchs: { OB: "1", RAY: "2" },
      Bets: [],
    }, 5000, { endedAt: 5000 });
    assert.equal(row.id, 42);
    assert.equal(row.ended_at, 5000);
    assert.deepEqual(row.matchs, { OB: "1", RAY: "2" });

    const active = clientMatchWriteRow({
      ID: 42,
      Title: "A vs B",
      Matchs: { OB: "1", RAY: "2" },
    }, 5000, { endedAt: null });
    assert.equal(active.ended_at, null);
  });

  it("dry-run does not reuse ended id via merge_key (M3)", () => {
    const existing = [
      {
        id: 1459,
        merge_key: "match:id:3:100601:101107",
        matchs: { RAY: "old", Polymarket: "oldpm" },
        ended_at: 1_700_000_000_000,
      },
    ];
    const built = [{
      MergeKey: "match:id:3:100601:101107",
      Matchs: { OB: "newob", Polymarket: "newpm", PredictFun: "newpf", PB: "newpb" },
      Title: "Metanoia Wolves vs MEIA NOITE",
    }];
    const out = resolveIdsDryRun(built, { existingClientRows: existing });
    assert.ok(out[0].ID < 0, "should get temp id, not ended 1459");
    assert.notEqual(out[0].ID, 1459);
  });

  it("dry-run does not reuse ended id via platform overlap (M3)", () => {
    const existing = [
      {
        id: 77,
        merge_key: "match:id:1:10:20",
        matchs: { OB: "ob77", RAY: "ray77" },
        ended_at: 1_700_000_000_000,
      },
    ];
    const built = [{
      MergeKey: "match:name:other",
      Matchs: { OB: "ob77", RAY: "ray77" },
      Title: "reuse",
    }];
    const out = resolveIdsDryRun(built, { existingClientRows: existing });
    assert.ok(out[0].ID < 0);
    assert.notEqual(out[0].ID, 77);
  });

  it("dry-run still reuses active id via merge_key", () => {
    const existing = [
      {
        id: 88,
        merge_key: "match:id:3:1:2",
        matchs: { OB: "a", RAY: "b" },
        ended_at: null,
      },
    ];
    const built = [{
      MergeKey: "match:id:3:1:2",
      Matchs: { OB: "a", RAY: "b", Polymarket: "c" },
      Title: "live",
    }];
    const out = resolveIdsDryRun(built, { existingClientRows: existing });
    assert.equal(out[0].ID, 88);
  });

  it("platform overlap helper skips ended rows", () => {
    const id = findReuseIdByPlatformOverlap(
      [
        { id: 15, matchs: { OB: "a", TF: "b" }, ended_at: 1 },
        { id: 16, matchs: { OB: "a", RAY: "c" } },
      ],
      { OB: "a", RAY: "c" },
    );
    assert.equal(id, 16);
    assert.ok(matchsSignature({ OB: "a", TF: "b" }).includes("OB:a"));
  });

  it("dry-run ignores platform link to ended client id (M3)", () => {
    const existing = [
      {
        id: 1459,
        merge_key: "match:id:3:100601:101107",
        matchs: { RAY: "old" },
        ended_at: 1_700_000_000_000,
      },
    ];
    const matches = {
      OB: { newob: { SourceMatchID: "newob", ClientMatchId: 1459 } },
      Polymarket: { newpm: { SourceMatchID: "newpm", ClientMatchId: 1459 } },
    };
    const built = [{
      MergeKey: "match:id:3:100601:101107",
      Matchs: { OB: "newob", Polymarket: "newpm" },
      Title: "Metanoia Wolves vs MEIA NOITE",
    }];
    const out = resolveIdsDryRun(built, { existingClientRows: existing, matches });
    assert.ok(out[0].ID < 0);
    assert.notEqual(out[0].ID, 1459);
  });

  it("dry-run rejects seed-assigned ended row.ID (M4)", () => {
    const existing = [
      {
        id: 1459,
        merge_key: "match:id:3:100601:101107",
        matchs: { OB: "newob", Polymarket: "newpm" },
        ended_at: 1_700_000_000_000,
      },
    ];
    const built = [{
      ID: 1459,
      MergeKey: "match:id:3:100601:101107",
      Matchs: { OB: "newob", Polymarket: "newpm" },
      Title: "Metanoia Wolves vs MEIA NOITE",
    }];
    const out = resolveIdsDryRun(built, { existingClientRows: existing });
    assert.ok(out[0].ID < 0);
    assert.notEqual(out[0].ID, 1459);
  });
});
