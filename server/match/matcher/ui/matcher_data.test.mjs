import { describe, expect, it } from "vitest";
import {
  buildRayRiskMatches,
  clientMatchWithPmStatus,
  computeRecommendations,
  dashboardRowsFromSnapshot,
  isPlatformMatchLinkedForRec,
} from "./matcher_data.js";

const T0 = Date.parse("2026-08-08T01:45:00+08:00");

describe("matcher PM status", () => {
  it("passes source-event PM status to unmatched rows without assigning a client match", () => {
    const raw = { Polymarket: [{ SourceMatchID: "pm1", SourceGameID: "cs2", StartTime: T0, Home: "Alpha", Away: "Beta" }],
      OB: [{ SourceMatchID: "pm1", StartTime: T0, Home: "Alpha", Away: "Beta" }] };
    const snapshot = { eventId: "pm1", source: "ws", live: true, period: "2/3", updatedAt: T0 };
    const rows = dashboardRowsFromSnapshot(raw, [], [], new Map([["pm1", snapshot]]));
    const pm = rows.find(row => row.platform === "Polymarket");
    expect(pm.pm_match_status).toEqual({ kind: "live", label: "进行中 · 地图2/3" });
    expect(pm.pm_sport).toEqual(snapshot);
    expect(pm.match_id).toBeNull();
    expect(rows.find(row => row.platform === "OB").pm_match_status).toBeUndefined();
    const missing = dashboardRowsFromSnapshot(raw, [], [], new Map([["another-event", snapshot]]));
    expect(missing.find(row => row.platform === "Polymarket").pm_match_status.kind).toBe("unknown");
  });
  it("shows the stored live status and preserves the source snapshot", () => {
    const input = { id: 42, start_time: T0 / 1000, matchs: { Polymarket: "pm1" },
      pm_sport: { source: "ws", status: "inprogress", period: "5/5", scoreRaw: "8-5|2-2",
        mapScore: { home: 2, away: 2 }, elapsed: "89" } };
    const original = structuredClone(input);
    const output = clientMatchWithPmStatus(input);
    expect(output.pm_match_status).toEqual({ kind: "live", label: "进行中 · 地图5/5 · 大比分2–2 · 已进行1:29" });
    expect(output.start_time).toBe(T0);
    expect(output.pm_sport).toEqual(input.pm_sport);
    expect(input).toEqual(original);
  });

  it.each([
    [{ status: "scheduled" }, "pending", "未开赛"],
    [{ status: "final", scoreRaw: "3-2", mapScore: { home: 3, away: 2 } }, "finished", "已结束 · 最终大比分3–2"],
    [{ status: "postponed", live: true }, "postponed", "延期"],
    [{ status: "canceled", ended: true }, "canceled", "已取消"],
  ])("uses PM state for active and hidden rows: %j", (snapshot, kind, label) => {
    for (const ended_at of [null, T0]) {
      expect(clientMatchWithPmStatus({ pm_sport: snapshot, ended_at }).pm_match_status)
        .toEqual({ kind, label });
    }
  });

  it("does not infer status from a past start time or add PM to an unrelated match", () => {
    expect(clientMatchWithPmStatus({ start_time: T0, matchs: { Polymarket: "pm1" } }).pm_match_status)
      .toEqual({ kind: "unknown", label: "状态待更新" });
    expect(clientMatchWithPmStatus({ start_time: T0, matchs: { OB: "ob1" } }).pm_match_status).toBeNull();
  });
});

it("keeps legacy ended sources out of recommendations after their reverse link was cleared", () => {
  const rows = dashboardRowsFromSnapshot({
    OB: [{ SourceMatchID: "ob1", SourceGameID: "2", Home: "Alpha", Away: "Beta", StartTime: T0 }],
    RAY: [{ SourceMatchID: "ray1", SourceGameID: "2", Home: "Alpha", Away: "Beta", StartTime: T0 }],
  }, [], [{ id: 42, ended_at: T0, matchs: { OB: "ob1", RAY: "ray1" } }]);
  expect(rows.every(row => row.bound_client_match_id === 42 && row.match_id === null)).toBe(true);
  expect(rows.every(row => isPlatformMatchLinkedForRec(row, []))).toBe(true);
  expect(computeRecommendations(rows, [])).toEqual([]);
  // 已结束来源也不能充当新推荐的另一侧平台。
  expect(computeRecommendations([...rows, { ...rows[0], platform: "Polymarket", source_match_id: "new",
    source_game_id: "dota2", match_id: null, bound_client_match_id: null, ended_client_match_id: null }], [])).toEqual([]);
});

it("keeps a restored active association ahead of duplicate ended history", () => {
  const active = { id: 42, ended_at: null, matchs: { OB: "ob1", RAY: "ray1" } };
  const history = { ...active, id: 41, ended_at: T0 };
  const rows = dashboardRowsFromSnapshot({
    OB: [{ SourceMatchID: "ob1", ClientMatchId: 42 }],
    RAY: [{ SourceMatchID: "ray1", ClientMatchId: 42 }],
  }, [active], [history, active]);
  expect(rows.every(row => row.bound_client_match_id === 42 && row.match_id === 42)).toBe(true);
  expect(rows.every(row => row.ended_client_match_id === null)).toBe(true);
});

describe("abnormal match dashboard details", () => {
  it("lists only recorded anomalies, preferring the merged title and normalized time", () => {
    const matches = [{ id: 42, title: "Alpha vs Beta", start_time: T0 / 1000, matchs: { RAY: "910001" } }];
    const original = structuredClone(matches);
    expect(buildRayRiskMatches(["910001"], matches, [{ source_match_id: "910002", home: "Normal", away: "Match" }]))
      .toEqual([{ rayMatchId: "910001", clientMatchId: 42, title: "Alpha vs Beta", startTime: T0, detailsAvailable: true }]);
    expect(matches).toEqual(original);
  });
  it("shows unmatched anomalies using the collected RAY teams and time", () => {
    expect(buildRayRiskMatches(["910001"], [], [{ source_match_id: "910001", home: "A", away: "B", start_time: T0 }]))
      .toEqual([{ rayMatchId: "910001", clientMatchId: null, title: "A vs B", startTime: T0, detailsAvailable: true }]);
  });
  it("keeps the anomaly visible by native ID even after match data disappears", () => {
    expect(buildRayRiskMatches(["910001"], [], []))
      .toEqual([{ rayMatchId: "910001", clientMatchId: null, title: "RAY 比赛 #910001", startTime: 0, detailsAvailable: false }]);
  });
  it("can use an existing source binding without mixing another abnormal match's title", () => {
    expect(buildRayRiskMatches(["910001"], [{ id: 42, title: "Bound match", matchs: { OB: "ob1" } }],
      [{ source_match_id: "910001", match_id: 42 }])[0].title).toBe("Bound match");
    expect(buildRayRiskMatches(["910001"], [{ id: 42, title: "Other match", matchs: { RAY: "910002" } }], [])[0].detailsAvailable).toBe(false);
  });
});

function row(overrides = {}) {
  return {
    platform: "Polymarket",
    source_match_id: "800206",
    source_game_id: "lol",
    start_time: T0,
    home: "Team Heretics",
    home_id: "lol:team-heretics",
    away: "Fnatic",
    away_id: "lol:fnatic",
    match_id: null,
    bound_client_match_id: null,
    ...overrides,
  };
}

describe("isPlatformMatchLinkedForRec", () => {
  it("treats bound_client_match_id as linked even when active client list is empty", () => {
    const m = row({ bound_client_match_id: 1259, match_id: null });
    expect(isPlatformMatchLinkedForRec(m, [])).toBe(true);
  });

  it("still links via visible multi-platform client_matches.matchs", () => {
    const m = row({ match_id: null, bound_client_match_id: null });
    const cms = [{
      id: 10,
      matchs: { Polymarket: "800206", PredictFun: "281786" },
    }];
    expect(isPlatformMatchLinkedForRec(m, cms)).toBe(true);
  });
});

describe("computeRecommendations", () => {
  it("drops groups already bound to an ended client_match", () => {
    const matches = [
      row({
        platform: "Polymarket",
        source_match_id: "800206",
        bound_client_match_id: 1259,
        match_id: null,
      }),
      row({
        platform: "PredictFun",
        source_match_id: "281786",
        bound_client_match_id: 1259,
        match_id: null,
      }),
    ];
    expect(computeRecommendations(matches, [])).toEqual([]);
  });

  it("keeps unbound cross-platform name/time candidates", () => {
    const matches = [
      row({ platform: "Polymarket", source_match_id: "800206" }),
      row({ platform: "PredictFun", source_match_id: "281786" }),
    ];
    const recs = computeRecommendations(matches, []);
    expect(recs).toHaveLength(1);
    expect(recs[0].platforms.sort()).toEqual(["Polymarket", "PredictFun"]);
  });
});

describe("dashboardRowsFromSnapshot", () => {
  it("keeps bound_client_match_id when client_match is no longer active", () => {
    const matchesRaw = {
      Polymarket: {
        800206: {
          SourceMatchID: "800206",
          SourceGameID: "lol",
          StartTime: T0,
          Home: "Team Heretics",
          HomeID: "lol:team-heretics",
          Away: "Fnatic",
          AwayID: "lol:fnatic",
          ClientMatchId: 1259,
        },
      },
      PredictFun: {
        281786: {
          SourceMatchID: "281786",
          SourceGameID: "lol",
          StartTime: T0,
          Home: "Team Heretics",
          HomeID: "lol:team-heretics",
          Away: "Fnatic",
          AwayID: "lol:fnatic",
          match_id: 1259,
        },
      },
    };
    // ended CM not in active snapshot
    const rows = dashboardRowsFromSnapshot(matchesRaw, []);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.match_id).toBeNull();
      expect(r.bound_client_match_id).toBe(1259);
    }
    expect(computeRecommendations(rows, [])).toEqual([]);
  });

  it("passes PB rot_num through snapshot rows", () => {
    const matchesRaw = {
      PB: {
        1633928872: {
          SourceMatchID: "1633928872",
          SourceGameID: "cs2",
          StartTime: T0,
          Home: "Spirit",
          Away: "NAVI",
          RotNum: "31832",
        },
      },
    };
    const rows = dashboardRowsFromSnapshot(matchesRaw, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].rot_num).toBe("31832");
    expect(rows[0].source_match_id).toBe("1633928872");
  });

  it("passes PB is_live through snapshot rows", () => {
    const matchesRaw = {
      PB: {
        live: {
          SourceMatchID: "1",
          SourceGameID: "cs2",
          StartTime: T0,
          Home: "A",
          Away: "B",
          IsLive: 1,
        },
        pre: {
          SourceMatchID: "2",
          SourceGameID: "cs2",
          StartTime: T0,
          Home: "A",
          Away: "B",
          IsLive: 0,
        },
      },
    };
    const rows = dashboardRowsFromSnapshot(matchesRaw, []);
    const byId = Object.fromEntries(rows.map(r => [r.source_match_id, r]));
    expect(byId["1"].is_live).toBe(true);
    expect(byId["2"].is_live).toBe(false);
  });
});
