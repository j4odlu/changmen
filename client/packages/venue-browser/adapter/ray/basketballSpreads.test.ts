import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { clearRayBasketballSpreads, getRayBasketballSpreads, ingestRayBasketballSpreads } from "./basketballSpreads";
import { loadRayBets } from "./markets";
import { handleRayRealtimeMessage } from "./collect";
import { groupRayOddsToSaveBets } from "./shared/save_bets";

const mock = vi.hoisted(() => ({ get: vi.fn(), entries: new Map<string, VenueOddsEntry>(), save: vi.fn() }));
vi.mock("@changmen/client-core/shared/http", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/client-core/shared/http")>(), directGet: mock.get,
}));
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  getVenueOddsEntry: (_platform: string, id: string) => mock.entries.get(id),
  isVenueOdds: (_platform: string, id: string) => mock.entries.has(id),
  saveVenueOdds: (...args: unknown[]) => mock.save(...args),
}));

const option = (id: string, team: number, value: string, status = 1) => ({
  odds_id: id, odds_group_id: 1279840, match_stage: "final", tag: "hdp", team_id: team, value, status, odds: 1.95,
});
function payload() {
  return { id: "m1", game_id: 1072082, team: [{ pos: 1, team_id: 10 }, { pos: 2, team_id: 20 }], odds: [
    option("away-45", 20, "+4.5"), option("home-45", 10, "-4.5"),
    option("home-55", 10, "-5.5"), option("away-55", 20, "+5.5", 2),
    { ...option("half", 10, "-4.5"), odds_group_id: 2275879, match_stage: "1st" },
    { ...option("total", 10, ">220.5"), odds_group_id: 1280153, tag: "ou" },
    { ...option("win-h", 10, ""), odds_group_id: 1279801, tag: "win", group_name: "获胜者(含加时)" },
    { ...option("win-a", 20, ""), odds_group_id: 1279801, tag: "win", group_name: "获胜者(含加时)" },
  ] };
}
beforeEach(() => {
  vi.clearAllMocks(); mock.entries.clear(); clearRayBasketballSpreads();
  mock.save.mockImplementation((_platform: string, entry: VenueOddsEntry, source = "http") => {
    mock.entries.set(entry.id, { ...entry, source: source as "http" | "mqtt" });
  });
});
afterEach(() => { vi.restoreAllMocks(); clearRayBasketballSpreads(); });

describe("RAY basketball spread display", () => {
  it("reuses one existing odds request and preserves the legacy report, raw payload and winner-only matchResult", async () => {
    const data = payload(), original = structuredClone(data);
    mock.get.mockResolvedValue({ code: 200, result: data });
    const result = await loadRayBets({ Gateway: "https://example.test/v2", Token: "fixture" }, "m1", /^获胜者$/, "basketball");
    expect(mock.get).toHaveBeenCalledOnce();
    expect(mock.get.mock.calls[0]![0]).toBe("https://example.test/v2/odds?match_id=m1");
    expect(result.bets).toEqual(groupRayOddsToSaveBets(data, /^获胜者$/, "RAY", "basketball"));
    expect(result.bets).toHaveLength(1);
    expect(result.bets[0]!.SourceBetID).toBe("1279801");
    // 原 matchResult 的名称过滤保持原样，不为扩展放宽。
    expect(result.matchResult?.odds).toEqual([]);
    expect(data).toEqual(original);
    const rows = getRayBasketballSpreads("m1")!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ home: { id: "home-55", line: "-5.5" }, away: { id: "away-55", line: "+5.5" } });
    expect(rows[1]).toMatchObject({ home: { id: "home-45" }, away: { id: "away-45" } });
    expect([...mock.entries.keys()].sort()).toEqual(["away-45", "away-55", "home-45", "home-55", "win-a", "win-h"]);
  });

  it("uses server reversal once, retaining zero, integer and composite native lines without mutating the snapshot", () => {
    const data = payload();
    data.odds = [option("h", 10, "-4.50"), option("a", 20, "+4.5"),
      option("z-h", 10, "-0"), option("z-a", 20, "0"),
      option("c-h", 10, "-4,-4.5"), option("c-a", 20, "+4,+4.5")];
    ingestRayBasketballSpreads("m1", data, "篮球");
    const normal = getRayBasketballSpreads("m1")!;
    const reversed = getRayBasketballSpreads("m1", true)!;
    expect(reversed.rows[0]).toMatchObject({ home: { id: "a", line: "+4.5" }, away: { id: "h", line: "-4.5" } });
    expect(normal.rows[0]!.home!.id).toBe("h");
    expect(normal.rows.find(row => row.home?.id === "z-h")).toMatchObject({ home: { line: "0" }, away: { line: "0" } });
    expect(normal.rows.find(row => row.home?.id === "c-h")).toMatchObject({ away: { id: "c-a", line: "+4,+4.5" } });
  });

  it("retains missing sides and unknown line text without pairing unrelated choices, and excludes removed or foreign rows", () => {
    const data = payload();
    data.odds = [option("single", 10, "-4.5"), option("odd-format", 20, "unsupported"),
      option("removed", 20, "+4.5", 4), option("foreign-team", 30, "+4.5")];
    ingestRayBasketballSpreads("m1", data, "basketball");
    const rows = getRayBasketballSpreads("m1")!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ home: { id: "single" }, away: null });
    expect(rows[1]).toMatchObject({ home: null, away: { id: "odd-format", line: "unsupported" } });
    expect(mock.entries.has("removed")).toBe(false);
    expect(mock.entries.has("foreign-team")).toBe(false);
  });

  it("lets the unchanged WS handler update registered spread IDs and keeps late HTTP prices from overwriting those updates", () => {
    ingestRayBasketballSpreads("m1", payload(), "basketball", 100);
    handleRayRealtimeMessage({ source: "odds", odds: [{ id: "home-45", odds: 2.12, status: 1 },
      { id: "unknown", odds: 9, status: 1 }] }, 300);
    expect(mock.entries.get("home-45")).toMatchObject({ odds: 2.12, source: "mqtt" });
    expect(mock.entries.has("unknown")).toBe(false);
    ingestRayBasketballSpreads("m1", payload(), "basketball", 200);
    expect(mock.entries.get("home-45")).toMatchObject({ odds: 2.12, source: "mqtt" });
    ingestRayBasketballSpreads("m1", payload(), "basketball", 400);
    expect(mock.entries.get("home-45")).toMatchObject({ odds: 1.95, source: "http" });
  });

  it("replaces complete snapshots on removal or ID changes, and rejects older, mismatched or malformed snapshots", () => {
    ingestRayBasketballSpreads("m1", payload(), "basketball", 100);
    const next = payload(); next.odds = [option("new-h", 10, "-4.5", 2)];
    ingestRayBasketballSpreads("m1", next, "basketball", 200);
    expect(getRayBasketballSpreads("m1")!.rows).toMatchObject([{ home: { id: "new-h" }, away: null }]);
    for (const invalid of [{ ...payload(), id: "other" }, { ...payload(), game_id: 140 }, { ...payload(), odds: undefined }])
      ingestRayBasketballSpreads("m1", invalid, "basketball", 300);
    ingestRayBasketballSpreads("m1", payload(), "cs2", 300);
    ingestRayBasketballSpreads("m1", payload(), "basketball", 100);
    expect(getRayBasketballSpreads("m1")!.rows[0]!.home!.id).toBe("new-h");
    ingestRayBasketballSpreads("m1", { ...next, odds: [] }, "basketball", 400);
    expect(getRayBasketballSpreads("m1")!.rows).toEqual([]);
  });

  it("isolates display failures from the existing winner request", async () => {
    mock.get.mockResolvedValue({ code: 200, result: payload() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.save.mockImplementation((_platform: string, entry: VenueOddsEntry) => {
      if (entry.id === "away-45") throw Error("display-only fixture");
    });
    const result = await loadRayBets({ Gateway: "https://example.test", Token: "fixture" }, "m1", /^获胜者$/, "basketball");
    expect(result.bets).toHaveLength(1);
    expect(result.bets[0]!.SourceBetID).toBe("1279801");
    expect(warn).toHaveBeenCalledOnce();
  });
});
