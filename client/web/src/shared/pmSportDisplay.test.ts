import { describe, expect, it } from "vitest";
import {
  buildPmSportDisplayParts,
  formatPmMatchStatus,
  formatResolutionSourceLabel,
  normalizeResolutionSourceHref,
} from "./pmSportDisplay";

describe("pmSportDisplay", () => {
  it.each([
    ["not_started", "未开赛", "pending"],
    ["running", "进行中", "live"],
    ["finished", "已结束", "finished"],
    ["postponed", "延期", "postponed"],
    ["canceled", "已取消", "canceled"],
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
      scoreRaw: "000-000|2-1|Bo3", mapScore: { home: 2, away: 1 },
    }).label).toBe("已结束 · 最终大比分2–1");
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
