import { expect, it, vi } from "vitest";
import { querySessionWithReconnect } from "./connection_retry.js";

it.each(["ECONNRESET", "EPIPE", "57P01", "08006", undefined])("reacquires a pool connection once after transport disconnect %s", async code => {
  const result = { rows: [{ id: "session" }] };
  const pool = { query: vi.fn().mockRejectedValueOnce(Object.assign(new Error("Connection terminated unexpectedly"), { code })).mockResolvedValueOnce(result) };
  await expect(querySessionWithReconnect(pool, "SELECT id FROM auth_sessions WHERE id=$1", ["id"], "session.read")).resolves.toBe(result);
  expect(pool.query.mock.calls).toEqual([["SELECT id FROM auth_sessions WHERE id=$1", ["id"]], ["SELECT id FROM auth_sessions WHERE id=$1", ["id"]]]);
});
it("persistent disconnect propagates after one retry rather than looping or reporting logout", async () => {
  const error = new Error("Connection terminated unexpectedly"); const pool = { query: vi.fn().mockRejectedValue(error) };
  await expect(querySessionWithReconnect(pool, "SELECT 1", [], "read")).rejects.toBe(error);
  expect(pool.query).toHaveBeenCalledTimes(2);
});
it.each(["57014", "23505", "40001", "28P01"])("does not replay SQL timeouts, constraints, transactions or authentication errors %s", async code => {
  const error = Object.assign(new Error("database error"), { code }); const pool = { query: vi.fn().mockRejectedValue(error) };
  await expect(querySessionWithReconnect(pool, "SELECT 1", [], "read")).rejects.toBe(error);
  expect(pool.query).toHaveBeenCalledOnce();
});
