import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null, query: vi.fn(), ready: vi.fn(), sessions: {} }));
vi.mock("../../../db/rds/common.js", () => ({ getPgPool: () => state.pool, _jsonb: value => JSON.stringify(value) }));
vi.mock("../../../db/pg_pool.js", () => ({ ensurePgPoolReady: state.ready }));
vi.mock("@changmen/storage/json_file_store.js", () => ({ readJsonFile: () => state.sessions }));
let login, presence;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(1700000000000);
  state.pool = { query: state.query }; state.sessions = {};
  state.query.mockImplementation(async sql => sql.startsWith("SELECT")
    ? { rows: [{ preferences: { other: "keep" } }] } : { rowCount: 1 });
  login = await import("./user_login_meta.js");
  presence = await import("./user_presence.js");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("login and presence observable behavior", () => {
  it("normalizes login input, confirms persistence and leaves invalid input untouched", async () => {
    expect(await login.recordUserLastLogin("", "::1")).toBe(false);
    expect(await login.recordUserLastLogin("user", " ")).toBe(false);
    expect(state.query).not.toHaveBeenCalled();
    expect(await login.recordUserLastLogin(" user ", "::ffff:203.0.113.1")).toBe(true);
    const writes = state.query.mock.calls.filter(([sql]) => sql.includes("UPDATE profiles"));
    expect(writes).toHaveLength(1);
    expect(writes[0][1][0]).toBe("user");
    expect(JSON.parse(writes[0][1][1])).toMatchObject({ lastLoginIp: "203.0.113.1", lastLoginAt: 1700000000000 });
  });
  it("does not acknowledge absent profiles or a zero-row update", async () => {
    state.query.mockResolvedValueOnce({ rows: [] });
    expect(await login.recordUserLastLogin("user", "::1")).toBe(false);
    expect(state.query).toHaveBeenCalledTimes(1);
    state.query.mockResolvedValueOnce({ rows: [{ preferences: {} }] }).mockResolvedValueOnce({ rowCount: 0 });
    expect(await login.recordUserLastLogin("user", "::1")).toBe(false);
  });
  it("propagates login write errors as before", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ preferences: {} }] }).mockRejectedValueOnce(new Error("write failed"));
    await expect(login.recordUserLastLogin("user", "::1")).rejects.toThrow("write failed");
  });
  it("coalesces touches for 60 seconds and uses the latest time", async () => {
    presence.touchUserPresence(" User ");
    await vi.advanceTimersByTimeAsync(30_000); presence.touchUserPresence("USER");
    await vi.advanceTimersByTimeAsync(29_999); expect(state.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[0][1]).toEqual(["user", JSON.stringify({ lastActiveAt: 1700000030000 }), 1700000060000]);
    expect(presence.isUserOnline("USER", 1700000030000 + 30 * 60_000 - 1)).toBe(true);
    expect(presence.isUserOnline("USER", 1700000030000 + 30 * 60_000)).toBe(false);
  });
  it("keeps memory presence on write failure and continues the batch without automatic retry", async () => {
    state.query.mockRejectedValueOnce(new Error("offline"));
    presence.touchUserPresence("a"); presence.touchUserPresence("b");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(presence.isUserOnline("a")).toBe(true);
    expect(presence.isUserOnline("b")).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(state.query).toHaveBeenCalledTimes(2);
    presence.touchUserPresence("a"); await vi.advanceTimersByTimeAsync(60_000);
    expect(state.query).toHaveBeenCalledTimes(3);
  });
  it("skips absent storage and preserves the one-shot legacy migration result", async () => {
    state.pool = null;
    presence.touchUserPresence("a"); await vi.advanceTimersByTimeAsync(60_000);
    expect(state.query).not.toHaveBeenCalled();
    expect(await presence.migrateLegacySessionsJsonToRds()).toEqual({ migrated: 0, skipped: true, reason: "no_db" });
    state.pool = { query: state.query };
    expect(await presence.migrateLegacySessionsJsonToRds()).toEqual({ migrated: 0, skipped: true });
  });
  it("migrates legacy timestamps once, skips bad entries and isolates row failures", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    state.sessions = { a: { userId: " A ", lastActiveAt: 100 }, b: { userId: "B", createdAt: 200 },
      c: { userId: "C", lastActiveAt: 300 }, empty: { userId: "" }, invalid: { userId: "x", lastActiveAt: "bad" } };
    state.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(new Error("bad row"));
    expect(await presence.migrateLegacySessionsJsonToRds()).toEqual({ migrated: 1 });
    expect(state.query).toHaveBeenCalledTimes(3);
    expect(state.query.mock.calls[0][1]).toEqual(["a", '{"lastActiveAt":100}', 1700000000000, 100]);
    expect(presence.getUserLastActiveAt("a")).toBe(100);
    expect(presence.getUserLastActiveAt("b")).toBe(200);
    expect(presence.getUserLastActiveAt("c")).toBe(0);
    expect(await presence.migrateLegacySessionsJsonToRds()).toEqual({ migrated: 0, skipped: true });
  });
  it("uses the newest memory or profile timestamp for display", () => {
    presence.touchUserPresence("user");
    expect(presence.resolvePresenceState("user", { preferences: { lastActiveAt: 1699999999999 } }))
      .toEqual({ lastActiveAt: 1700000000000, isOnline: 1 });
    expect(presence.resolvePresenceState("other", { preferences: { lastActiveAt: 1699998200000 } }))
      .toEqual({ lastActiveAt: 1699998200000, isOnline: 0 });
  });
});
