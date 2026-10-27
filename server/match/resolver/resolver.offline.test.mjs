import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, scoreMatchPair } from "./index.js";

const ports = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), configured: vi.fn(), panda: vi.fn(),
}));
vi.mock("./cache.js", () => ({ get: ports.get, set: ports.set }));
vi.mock("./providers/pandascore.js", () => ({ isConfigured: ports.configured, resolve: ports.panda }));

describe("resolver with offline provider ports", () => {
  beforeEach(() => {
    for (const port of Object.values(ports)) port.mockReset();
    ports.configured.mockReturnValue(false);
    ports.panda.mockResolvedValue(null);
  });
  it("returns an exact cached result without provider calls", async () => {
    ports.get.mockReturnValue({ id: "team", name: "Team", confidence: 1, matchType: "exact", source: "pandascore" });
    expect(await resolve("TEAM", "lol")).toMatchObject({ id: "team", source: "cache" });
    expect(ports.panda).not.toHaveBeenCalled();
  });
  it("never trusts an acronym-only cached identity", async () => {
    ports.get.mockReturnValue({ id: "guess", matchType: "acronym", source: "pandascore" });
    ports.configured.mockReturnValue(true);
    expect(await resolve("EDG", "lol")).toBeNull();
    expect(ports.panda).toHaveBeenCalledWith("EDG", "lol");
  });
  it("queries PandaScore and caches the resolved fact", async () => {
    ports.configured.mockReturnValue(true);
    ports.panda.mockResolvedValue({ id: "actual", name: "Actual", confidence: 1, source: "pandascore" });
    expect(await resolve("Actual", "lol")).toMatchObject({ id: "actual", source: "pandascore" });
    expect(ports.set).toHaveBeenCalledWith("actual", "lol", expect.objectContaining({ id: "actual" }));
  });
  it("returns null after provider failure without caching a result", async () => {
    ports.configured.mockReturnValue(true);
    ports.panda.mockRejectedValue(new Error("synthetic provider outage"));
    expect(await resolve("Actual", "lol")).toBeNull();
    expect(ports.set).not.toHaveBeenCalled();
  });
  it("returns null on a cache miss when PandaScore is unconfigured", async () => {
    expect(await resolve("Actual", "lol")).toBeNull();
    expect(ports.panda).not.toHaveBeenCalled();
    expect(ports.set).not.toHaveBeenCalled();
  });
  it("returns null when PandaScore finds no team", async () => {
    ports.configured.mockReturnValue(true);
    expect(await resolve("Actual", "lol")).toBeNull();
    expect(ports.panda).toHaveBeenCalledOnce();
    expect(ports.set).not.toHaveBeenCalled();
  });
  it("ignores cached identities from retired sources", async () => {
    ports.get.mockReturnValue({ id: "retired:team", confidence: 1, source: "retired-provider" });
    expect(await resolve("Actual", "lol")).toBeNull();
    ports.configured.mockReturnValue(true);
    ports.panda.mockResolvedValue({ id: "pandascore:123", confidence: 1, source: "pandascore" });
    expect(await resolve("Actual", "lol")).toMatchObject({ id: "pandascore:123", source: "pandascore" });
    expect(ports.set).toHaveBeenCalledWith("actual", "lol", expect.objectContaining({ id: "pandascore:123" }));
  });
  it("bypasses cached identities when forceRefresh is requested", async () => {
    ports.get.mockReturnValue({ id: "cached", source: "pandascore" });
    ports.configured.mockReturnValue(true);
    ports.panda.mockResolvedValue({ id: "fresh", source: "pandascore" });
    expect(await resolve("Actual", "lol", { forceRefresh: true })).toMatchObject({ id: "fresh" });
    expect(ports.get).not.toHaveBeenCalled();
  });
  it("rejects empty names without cache or provider access", async () => {
    expect(await resolve("  ", "lol")).toBeNull();
    expect(ports.get).not.toHaveBeenCalled();
    expect(ports.panda).not.toHaveBeenCalled();
  });
  it("reports an unresolved pair when its provider cannot resolve teams", async () => {
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, pair)).toMatchObject({ shouldMerge: false, reason: "teams_not_resolved" });
  });
  it("recognizes aligned canonical pairs", async () => {
    ports.get.mockImplementation(name => ({ id: name, confidence: 1, matchType: "exact", source: "pandascore" }));
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, pair)).toMatchObject({ shouldMerge: true, reason: "both_teams_matched" });
  });
  // Existing resolver/index.js compares the wrong cross legs. Keep this known defect visible;
  // phase 1 changes test wiring only and must not alter matching behavior.
  it.fails("known legacy gap: reversed canonical pairs should be recognized", async () => {
    ports.get.mockImplementation(name => ({ id: name, confidence: 1, matchType: "exact", source: "pandascore" }));
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, { ...pair, home: "B", away: "A" }))
      .toMatchObject({ shouldMerge: true, reversed: true });
  });
  it("rejects different games and distant schedules before resolving", async () => {
    const pair = { home: "A", away: "B", gameCode: "lol", startTimeMs: 1000 };
    expect(await scoreMatchPair(pair, { ...pair, gameCode: "dota2" })).toMatchObject({ shouldMerge: false, reason: "game_mismatch" });
    expect(await scoreMatchPair(pair, { ...pair, startTimeMs: 3601000 })).toMatchObject({ shouldMerge: false, reason: "time_too_far" });
    expect(ports.panda).not.toHaveBeenCalled();
  });
});
