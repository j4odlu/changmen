import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), inherit: vi.fn() }));
vi.mock("./common.js", () => ({
  _jsonb: (value, fallback) => JSON.stringify(value ?? fallback),
  _writeRds: vi.fn(),
  getPgPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }),
}));
vi.mock("./platform_pm_sport.js", () => ({ inheritPlatformPmSports: mocks.inherit }));
import { writeClientMatchesAsync } from "./client_matches_store.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mocks.inherit.mockResolvedValue(1);
});

it("inherits status for active, newly ended and sticky ended matches before committing", async () => {
  const events = [];
  mocks.query.mockImplementation(async sql => { events.push(sql.trim().split(/\s+/)[0]); return {}; });
  mocks.inherit.mockImplementation(async (client, ids) => {
    expect(client.query).toBe(mocks.query);
    expect(ids).toEqual([1, 2, 3]);
    events.push("inherit");
  });
  await writeClientMatchesAsync({
    activeRows: [{ id: 1, built_at: 100 }],
    endedRows: [{ id: 2, built_at: 100, ended_at: 99 }],
    markEndedIds: [3], builtAt: 100,
  });
  expect(events).toEqual(["BEGIN", "INSERT", "INSERT", "UPDATE", "inherit", "COMMIT"]);
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("rolls back the whole match publication when status inheritance fails", async () => {
  mocks.inherit.mockRejectedValue(new Error("source state read failed"));
  await expect(writeClientMatchesAsync([{ id: 1, built_at: 100 }])).rejects.toThrow("source state read failed");
  expect(mocks.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
  expect(mocks.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
  expect(mocks.release).toHaveBeenCalledOnce();
});
