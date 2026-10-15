import { beforeEach, expect, it, vi } from "vitest";
import { listPmGtcClientImport } from "./pm_gtc_client_import.js";
const mock = vi.hoisted(() => ({ query: vi.fn(), ready: true }));
vi.mock("../../common.js", () => ({ getPgPool: () => mock.ready ? { query: mock.query } : null }));
beforeEach(() => { vi.clearAllMocks(); mock.ready = true; });
it("reads full owned history without a 500-row limit or any writes", async () => {
  const rows = Array.from({ length: 701 }, (_, id) => ({ record: { id } })); mock.query.mockResolvedValue({ rows });
  expect(await listPmGtcClientImport("owner")).toHaveLength(701);
  expect(mock.query).toHaveBeenCalledExactlyOnceWith("SELECT record FROM pm_gtc_executions WHERE owner=$1 ORDER BY updated_at DESC", ["owner"]);
});
it("an absent legacy table is empty; other database errors remain visible", async () => {
  mock.query.mockRejectedValue({ code: "42P01", message: 'relation "pm_gtc_executions" does not exist' }); expect(await listPmGtcClientImport("owner")).toEqual([]);
  mock.query.mockRejectedValue(new Error("offline")); await expect(listPmGtcClientImport("owner")).rejects.toThrow("offline");
  mock.ready = false; await expect(listPmGtcClientImport("owner")).rejects.toThrow("RDS");
});
