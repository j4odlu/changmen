import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAdminOrderLogs } from "./admin_orders.js";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), visible: vi.fn() }));
vi.mock("@changmen/db", () => ({}));
vi.mock("../admin_tools/user_log_lookup.js", () => ({ lookupOrderLogs: mocks.lookup, toAdminOrderLogPayload: result => result }));
vi.mock("../auth/admin_auth.js", () => ({ isAdminUser: caller => caller.role === "admin" }));
vi.mock("../auth/role_filter.js", () => ({ getVisibleUserIds: mocks.visible, resolveVisibleUserIds: vi.fn() }));
vi.mock("./order_store.js", () => ({ enrichOrdersBelongingToDate: vi.fn(), resolveStoredLink: vi.fn(), rowToOrder: vi.fn(), toDateKey: vi.fn() }));

describe("按事件编号查看订单依据", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue({ ok: true }); mocks.visible.mockResolvedValue(new Set(["u1"])); });
  it("forwards an exact evidence ID through the existing read-only admin route", async () => {
    await expect(listAdminOrderLogs({ userId: "u1", eventId: "event-123" }, { role: "admin" })).resolves.toEqual({ ok: true });
    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", eventId: "event-123" }));
  });
  it("retains user visibility checks before querying evidence", async () => {
    await expect(listAdminOrderLogs({ userId: "u2", eventId: "event-123" }, { role: "operator" })).rejects.toThrow("无权查看");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("only enables direct-first queries for an explicit boolean flag", async () => {
    await listAdminOrderLogs({ userId: "u1", linkId: 123, preferDirect: true }, { role: "admin" });
    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({ preferDirect: true }));
    await listAdminOrderLogs({ userId: "u1", linkId: 123, preferDirect: "true" }, { role: "admin" });
    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({ preferDirect: false }));
  });
});
