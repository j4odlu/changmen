import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), ddl: vi.fn() }));
vi.mock("../../../db/rds/common.js", () => ({ getPgPool: () => ({ query: mocks.ddl, connect: async () => ({ query: mocks.query, release: mocks.release }) }) }));
import { reservePodBetExecution } from "../../../db/rds/pod_bet_execution_store.js";
const row = { userId: "user", alertId: "alert-2", venue: "OB", playerId: 7, leaseToken: "lease", now: 100, outcomeScope: "mid|FT|Total" };
beforeEach(() => { vi.clearAllMocks(); mocks.ddl.mockResolvedValue({ rows: [] }); });
it("serializes the market scope and blocks a different alert with an unknown submission", async () => {
  mocks.query.mockImplementation(async sql => ({ rows: sql.includes("state IN") ? [{ alert_id: "alert-1", state: "unknown" }] : [] }));
  expect(await reservePodBetExecution(row)).toMatchObject({ acquired: false, row: { state: "unknown" } });
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  expect(mocks.query).toHaveBeenLastCalledWith("COMMIT");
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("inserts a new alert only after checking reserved, accepted and unknown states", async () => {
  mocks.query.mockImplementation(async sql => ({ rows: sql.includes("INSERT INTO") ? [{ state: "reserved" }] : [] }));
  expect(await reservePodBetExecution(row)).toMatchObject({ acquired: true });
  const scopeCall = mocks.query.mock.calls.find(([sql]) => sql.includes("state IN"));
  expect(scopeCall[1]).toEqual(["user", "OB", 7, "mid|FT|Total"]);
  const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO"));
  expect(insert[1].at(-1)).toBe(row.outcomeScope);
});
it("rolls back and releases the connection on reservation failure", async () => {
  mocks.query.mockImplementation(async sql => { if (sql.includes("INSERT INTO")) throw new Error("database failure"); return { rows: [] }; });
  await expect(reservePodBetExecution(row)).rejects.toThrow("database failure");
  expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
  expect(mocks.release).toHaveBeenCalledOnce();
});
