import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null }));
vi.mock("./common.js", () => ({ getPgPool: () => state.pool, _writeRds: vi.fn(), _writeRdsAsync: vi.fn() }));
import { fetchPlatformMatches, fetchPlatformBets, fetchLiveTimers } from "./platform_collector_store.js";
beforeEach(() => { state.pool = null; });
it("matcher required reads reject unavailable storage instead of reporting all sources gone", async () => {
  for (const read of [fetchPlatformMatches, fetchPlatformBets, fetchLiveTimers]) {
    await expect(read({ strict: true })).rejects.toThrow("数据库不可用");
    await expect(read()).resolves.toEqual({});
  }
});
it("query errors abort matcher input, while a successful empty query remains valid", async () => {
  state.pool = { query: vi.fn().mockRejectedValue(new Error("synthetic query failure")) };
  for (const read of [fetchPlatformMatches, fetchPlatformBets, fetchLiveTimers])
    await expect(read({ strict: true })).rejects.toThrow("synthetic query failure");
  state.pool.query.mockResolvedValue({ rows: [] });
  for (const read of [fetchPlatformMatches, fetchPlatformBets, fetchLiveTimers])
    await expect(read({ strict: true })).resolves.toEqual({});
});
