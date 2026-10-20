import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeProfileAsync } from "./profile_store.js";

const state = vi.hoisted(() => ({ pool: null, query: vi.fn() }));
vi.mock("./common.js", () => ({
  getPgPool: () => state.pool,
  _jsonb: (value, fallback) => JSON.stringify(value ?? fallback),
}));

describe("profile persistence confirmation", () => {
  beforeEach(() => { state.query.mockReset(); state.pool = { query: state.query }; });
  it("requires an available database", async () => {
    state.pool = null;
    await expect(writeProfileAsync("user", { preferences: {} })).rejects.toThrow("数据库不可用");
  });
  it("requires one updated profile", async () => {
    state.query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(writeProfileAsync("user", { preferences: {} })).rejects.toThrow("profile 不存在");
  });
  it("propagates SQL failure", async () => {
    state.query.mockRejectedValueOnce(new Error("SQL failure"));
    await expect(writeProfileAsync("user", { preferences: {} })).rejects.toThrow("SQL failure");
  });
  it("confirms the successful write", async () => {
    state.query.mockResolvedValueOnce({ rowCount: 1 });
    await expect(writeProfileAsync("user", { collect_config: { collect: [] } })).resolves.toBeUndefined();
  });
});
