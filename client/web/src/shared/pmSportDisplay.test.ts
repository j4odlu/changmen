import { describe, expect, it } from "vitest";
import {
  buildPmSportDisplayParts,
  readPmMapRoundScore,
  isPmMapLive,
  formatPmMatchStatus,
  formatResolutionSourceLabel,
  normalizeResolutionSourceHref,
} from "./pmSportDisplay";

describe("pmSportDisplay", () => {
  it("marks the current PM map live from a real VPS message without elapsed", () => {
    const snapshot = {
      status: "running", live: true, ended: false, period: "3/3",
      scoreRaw: "000-000|1-1|Bo3", mapScore: { home: 1, away: 1 },
    };
    expect(formatPmMatchStatus(snapshot).label).toBe("进行中 · 地图3/3 · 大比分1–1");
    expect(isPmMapLive(snapshot, 3)).toBe(true);
    expect(isPmMapLive({ live: true, currentMap: 2 }, 2)).toBe(true);
    expect(isPmMapLive({ status: "InProgress", period: "2/3" }, 2)).toBe(true);
  });

  it("never marks full-match, other maps or inactive matches live", () => {
    const snapshot = { live: true, currentMap: 2 };
    for (const map of [0, 1, 3, -1, 2.5])
      expect(isPmMapLive(snapshot, map)).toBe(false);
    for (const status of ["finished", "final", "postponed", "canceled", "cancelled"])
      expect(isPmMapLive({ ...snapshot, status }, 2)).toBe(false);
    for (const status of ["scheduled", "not_started", "unknown"])
      expect(isPmMapLive({ live: false, currentMap: 2, status }, 2)).toBe(false);
    expect(isPmMapLive({ ...snapshot, ended: true }, 2)).toBe(false);
    expect(isPmMapLive({ currentMap: 2 }, 2)).toBe(false);
    expect(isPmMapLive({ live: true }, 2)).toBe(false);
    expect(isPmMapLive(undefined, 2)).toBe(false);
  });

  it.each([
    ["not_started", "未开赛", "pending"],
    ["running", "进行中", "live"],
    ["finished", "已结束", "finished"],
    ["postponed", "延期", "postponed"],
    ["canceled", "已取消", "canceled"],
    ["F/OT", "已结束", "finished"],
    ["Suspended", "暂停", "suspended"],
    ["Delayed", "延迟", "delayed"],
    ["Forfeit", "弃权", "forfeit"],
    ["NotNecessary", "无需进行", "notnecessary"],
  ])("formats whole-match status %s", (status, label, kind) => {
    expect(formatPmMatchStatus({ status })).toEqual({ label, kind });
  });

  it("shows map progress, title-aligned series score and supplied clock during play", () => {
    expect(formatPmMatchStatus({
      status: "running", period: "2/3", scoreRaw: "000-000|0-1|Bo3",
      mapScore: { home: 1, away: 0 }, elapsed: "755",
    })).toEqual({ label: "进行中 · 地图2/3 · 大比分1–0 · 已进行12:35", kind: "live" });
    expect(formatPmMatchStatus({ status: "running", currentMap: 3, bo: 5, elapsed: "00:00" }).label)
      .toBe("进行中 · 地图3/5 · 已进行00:00");
  });

  it("shows final series score without a stale map or clock", () => {
    expect(formatPmMatchStatus({
      status: "finished", period: "3/3", elapsed: "35:00",
      scoreRaw: "13-8|2-1|Bo3", mapScore: { home: 2, away: 1 },
    }).label).toBe("已结束 · 最终大比分2–1");
  });

  it("shows an official basketball overtime final with observed points", () => {
    expect(formatPmMatchStatus({ status: "F/OT", live: false, ended: false,
      scoreRaw: "110-108", mapScore: { home: 110, away: 108 }, period: "OT", elapsed: "0:00" }))
      .toEqual({ label: "已结束 · 最终大比分110–108", kind: "finished" });
  });

  it("shows basketball periods without inventing an esports map", () => {
    for (const period of ["1Q", "2Q", "Q4"])
      expect(formatPmMatchStatus({ status: "InProgress", period, currentMap: null,
        scoreRaw: "98-94", mapScore: { home: 98, away: 94 } }).label)
        .toBe(`进行中 · 阶段${period} · 大比分98–94`);
  });

  it("does not treat basketball exceptional statuses as live or infer an absent state", () => {
    for (const status of ["Suspended", "Delayed", "Forfeit", "NotNecessary"])
      expect(isPmMapLive({ status, live: true, currentMap: 2 }, 2)).toBe(false);
    expect(formatPmMatchStatus({ period: "NS", scoreRaw: "98-94", mapScore: { home: 98, away: 94 } }))
      .toEqual({ label: "状态待更新", kind: "unknown" });
  });

  it("shows observed in-map score separately from the series score", () => {
    const snapshot = {
      status: "running", period: "3/5", scoreRaw: "8-6|1-1|Bo5",
      mapScore: { home: 1, away: 1 },
    };
    expect(readPmMapRoundScore(snapshot, 3)).toEqual({ home: 8, away: 6 });
    expect(formatPmMatchStatus(snapshot).label).toBe("进行中 · 地图3/5 · 大比分1–1");
  });

  it("aligns raw in-map score even when the series score is tied and the push is already aligned", () => {
    expect(readPmMapRoundScore({
      status: "running", period: "3/5", scoreRaw: "8-6|1-1|Bo5",
      mapScore: { home: 1, away: 1 }, homeTeam: "DENDELE CS", awayTeam: "Wildcard",
    }, 3, true)).toEqual({ home: 6, away: 8 });
  });

  it.each(["000-000|1-1|Bo5", "0-0|1-1|Bo5", "invalid|1-1|Bo5", "1-1"])(
    "does not show placeholder, malformed or series-only score as an in-map score: %s", scoreRaw => {
      expect(readPmMapRoundScore({ status: "running", currentMap: 3, scoreRaw }, 3)).toBeNull();
    },
  );

  it("never copies the current score to full-match, previous or future map titles", () => {
    const snapshot = { live: true, currentMap: 3, scoreRaw: "8-6|1-1|Bo5" };
    for (const map of [0, 1, 2, 4])
      expect(readPmMapRoundScore(snapshot, map)).toBeNull();
    expect(readPmMapRoundScore(snapshot, 3)).toEqual({ home: 8, away: 6 });
    expect(readPmMapRoundScore({ ...snapshot, ended: true }, 3)).toBeNull();
  });

  it("does not expose parser-default zero scores as observed scores", () => {
    expect(formatPmMatchStatus({ status: "running", mapScore: { home: 0, away: 0 } }).label).toBe("进行中");
    expect(formatPmMatchStatus({ status: "running", scoreRaw: "invalid", mapScore: { home: 0, away: 0 } }).label).toBe("进行中");
    expect(formatPmMatchStatus({ status: "running", scoreRaw: "000-000|0-0|Bo3", mapScore: { home: 0, away: 0 } }).label)
      .toBe("进行中 · 大比分0–0");
  });

  it("does not present missing status as an unstarted game", () => {
    expect(formatPmMatchStatus(undefined)).toEqual({ label: "状态待更新", kind: "unknown" });
    expect(formatPmMatchStatus({ live: false, ended: false })).toEqual({ label: "状态待更新", kind: "unknown" });
    expect(formatPmMatchStatus({ live: true })).toEqual({ label: "进行中", kind: "live" });
    expect(formatPmMatchStatus({ ended: true, live: true })).toEqual({ label: "已结束", kind: "finished" });
  });

  it("keeps cancellation and postponement visible despite conflicting live flags", () => {
    expect(formatPmMatchStatus({ status: "canceled", live: true, ended: true }).kind).toBe("canceled");
    expect(formatPmMatchStatus({ status: "postponed", live: true }).kind).toBe("postponed");
  });

  it("builds link part for resolutionSource", () => {
    const parts = buildPmSportDisplayParts({
      status: "not_started",
      resolutionSource: "https://kick.com/cct_cs",
    });
    expect(parts).toEqual([
      { kind: "text", text: "未开始" },
      { kind: "link", text: "来源 kick.com/cct_cs", href: "https://kick.com/cct_cs" },
    ]);
  });

  it("shows PM map score and period only", () => {
    const parts = buildPmSportDisplayParts({
      status: "running",
      live: true,
      period: "2/3",
      mapScore: { home: 1, away: 0 },
    });
    expect(parts[0]).toEqual({ kind: "text", text: "进行中 · 2/3 · 1-0" });
    expect(parts.some(p => p.kind === "text" && String(p.text).includes("图"))).toBe(false);
  });

  it("normalizes bare host resolutionSource", () => {
    expect(normalizeResolutionSourceHref("kick.com/cct_cs")).toBe("https://kick.com/cct_cs");
    expect(formatResolutionSourceLabel("https://www.twitch.tv/valorant_tur")).toBe("来源 twitch.tv/valorant_tur");
  });
});
