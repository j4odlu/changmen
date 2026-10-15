import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, scoreMatchPair } from "./index.js";

const ports = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), configured: vi.fn(), panda: vi.fn(), liquipedia: vi.fn(),
}));
vi.mock("./cache.js", () => ({ get: ports.get, set: ports.set }));
vi.mock("./providers/pandascore.js", () => ({ isConfigured: ports.configured, resolve: ports.panda }));
vi.mock("./providers/liquipedia.js", () => ({ resolve: ports.liquipedia }));

describe("resolver with offline provider ports", () => {
  beforeEach(() => {
    for (const port of Object.values(ports)) port.mockReset();
    ports.configured.mockReturnValue(false);
    ports.liquipedia.mockResolvedValue(null);
  });
  it("returns an exact cached result without provider calls", async () => {
    ports.get.mockReturnValue({ id: "team", name: "Team", confidence: 1, matchType: "exact" });
    expect(await resolve("TEAM", "lol")).toMatchObject({ id: "team", source: "cache" });
    expect(ports.liquipedia).not.toHaveBeenCalled();
    expect(ports.panda).not.toHaveBeenCalled();
  });
  it("never trusts an acronym-only cached identity", async () => {
    ports.get.mockReturnValue({ id: "guess", matchType: "acronym" });
    expect(await resolve("EDG", "lol")).toBeNull();
    expect(ports.liquipedia).toHaveBeenCalledOnce();
  });
  it("falls back after provider failure and caches the resolved fact", async () => {
    ports.configured.mockReturnValue(true);
    ports.panda.mockRejectedValue(new Error("synthetic provider outage"));
    ports.liquipedia.mockResolvedValue({ id: "actual", name: "Actual", confidence: 1 });
    expect(await resolve("Actual", "lol")).toMatchObject({ id: "actual" });
    expect(ports.set).toHaveBeenCalledWith("actual", "lol", expect.objectContaining({ id: "actual" }));
  });
  it("reports an unresolved pair when its provider cannot resolve teams", async () => {
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, pair)).toMatchObject({ shouldMerge: false, reason: "teams_not_resolved" });
  });
  it("recognizes aligned canonical pairs", async () => {
    ports.get.mockImplementation(name => ({ id: name, confidence: 1, matchType: "exact" }));
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, pair)).toMatchObject({ shouldMerge: true, reason: "both_teams_matched" });
  });
  // Existing resolver/index.js compares the wrong cross legs. Keep this known defect visible;
  // phase 1 changes test wiring only and must not alter matching behavior.
  it.fails("known legacy gap: reversed canonical pairs should be recognized", async () => {
    ports.get.mockImplementation(name => ({ id: name, confidence: 1, matchType: "exact" }));
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, { ...pair, home: "B", away: "A" }))
      .toMatchObject({ shouldMerge: true, reversed: true });
  });
  it("rejects different games and distant schedules before resolving", async () => {
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, { ...pair, gameCode: "dota2" })).toMatchObject({ shouldMerge: false, reason: "game_mismatch" });
    expect(await scoreMatchPair(pair, { ...pair, startTimeMs: 3601000 })).toMatchObject({ shouldMerge: false, reason: "time_too_far" });
    expect(ports.liquipedia).not.toHaveBeenCalled();
  });
});
