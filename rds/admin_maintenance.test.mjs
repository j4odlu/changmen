import { expect, test } from "vitest";
import { readPolymarketHistoryAuditSnapshot } from "./admin_maintenance.js";

function fixture({ readOnly = "on", fail = false } = {}) {
  const calls = [], rows = [{ id: "1", provider: "Polymarket", raw: { pmTokenId: "101" } }];
  return { calls, rows, client: { async query(sql) {
    calls.push(sql);
    if (sql.includes("current_setting")) return { rows: [{ read_only: readOnly, captured_at: "audit-time" }] };
    if (sql.includes("FROM orders")) {
      if (fail) throw new Error("snapshot unavailable");
      return { rows };
    }
    return { rows: [] };
  } } };
}
test("historical PM audit reads all PM rows in a read-only snapshot and rolls back", async () => {
  const f = fixture();
  expect(await readPolymarketHistoryAuditSnapshot(f.client)).toEqual({ readOnly: true, capturedAt: "audit-time", rows: f.rows, gtcRows: [], counterpartRows: [] });
  expect(f.calls[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  expect(f.calls.at(-1)).toBe("ROLLBACK");
  const select = f.calls.find(sql => sql.includes("FROM orders"));
  expect(select).toContain("WHERE provider = 'Polymarket'");
  expect(select).not.toMatch(/LIMIT|create_at\s*[<>]/i);
  expect(f.calls.join("\n")).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|ALTER|TRUNCATE|COMMIT)\b/i);
});
test("audit fails closed if the connection is not read-only", async () => {
  const f = fixture({ readOnly: "off" });
  await expect(readPolymarketHistoryAuditSnapshot(f.client)).rejects.toThrow("read-only transaction");
  expect(f.calls.some(sql => sql.includes("FROM orders"))).toBe(false);
  expect(f.calls.at(-1)).toBe("ROLLBACK");
});
test("audit propagates query failures and releases its transaction", async () => {
  const f = fixture({ fail: true });
  await expect(readPolymarketHistoryAuditSnapshot(f.client)).rejects.toThrow("snapshot unavailable");
  expect(f.calls.at(-1)).toBe("ROLLBACK");
});
