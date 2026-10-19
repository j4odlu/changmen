import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/pg_pool.js", () => ({
  getPgPool: vi.fn(() => null),
  ensurePgPoolReady: vi.fn(async () => {}),
}));

describe("admin_maintenance suggestions via report shape", () => {
  it("exports report helpers", async () => {
    const mod = await import("./admin_maintenance.js");
    expect(typeof mod.getAdminMaintenanceReport).toBe("function");
    expect(typeof mod.listSharedVenueAccounts).toBe("function");
    expect(typeof mod.listDuplicateOrderIds).toBe("function");
  });

  it("throws when db unavailable", async () => {
    const { listSharedVenueAccounts } = await import("./admin_maintenance.js");
    await expect(listSharedVenueAccounts()).rejects.toThrow("数据库未就绪");
  });
});
