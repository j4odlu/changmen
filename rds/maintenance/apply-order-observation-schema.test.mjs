import { describe, expect, it, vi } from "vitest";
import { applyOrderObservationSchema } from "./apply-order-observation-schema.mjs";

const indexes = ["link", "attempt", "queue", "order", "execution"].map(name => ({ indexname: `order_observations_user_${name}` }));

describe("部署旁路观察 schema", () => {
  it("creates the table before its execution index and verifies every query index", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: indexes });
    await applyOrderObservationSchema({ query });
    expect(query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS order_observations");
    expect(query.mock.calls[1][0]).toContain("CREATE INDEX IF NOT EXISTS order_observations_user_execution");
    expect(query.mock.calls[2][0]).toContain("pg_indexes");
    expect(query.mock.calls.slice(0, 2).map(call => call[0]).join("\n")).not.toMatch(/(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:orders|players)/i);
  });
  it("fails deployment when schema execution fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(applyOrderObservationSchema({ query })).rejects.toThrow("database unavailable");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("fails deployment if an expected index is still missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: indexes.slice(0, 4) });
    await expect(applyOrderObservationSchema({ query })).rejects.toThrow("order_observations_user_execution");
  });
});
