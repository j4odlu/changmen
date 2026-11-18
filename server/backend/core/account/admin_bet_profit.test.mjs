import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBetProfitAnalytics, getValueBetOrderAnalytics } from "./admin_service.js";
import { handleAdminAction } from "../esport-api/admin_routes.ts";
const mock = vi.hoisted(() => ({ ob: vi.fn(), ev: vi.fn(), evProfit: vi.fn() }));
vi.mock("@changmen/db", () => ({
  fetchObSingleOrderAnalytics: mock.ob, fetchValueBetOrderAnalytics: mock.ev,
  fetchValueBetProfitAnalytics: mock.evProfit,
  fetchProfilesAdmin: vi.fn(async () => [{ id: "u1", team_id: "t1" }, { id: "u2", team_id: "t2" }]),
}));
const admin = { id: "a", role: "admin", userName: "admin" };
const payload = { byProvider: [], byOddsBucket: [], byDay: [] };
beforeEach(() => { vi.clearAllMocks(); mock.ob.mockResolvedValue(payload); mock.ev.mockResolvedValue(payload); mock.evProfit.mockResolvedValue(payload); });
describe("admin bet profit analytics", () => {
  it.each(["obSingle", "valueBet"])("dispatches %s through the real route with the month bounds", async (mode) => {
    const result = await handleAdminAction("Client_AdminBetProfitAnalytics", { mode, month: "2026-11" }, { user: admin });
    expect(result).toMatchObject({ success: 1, info: payload });
    const selected = mode === "obSingle" ? mock.ob : mock.evProfit;
    expect(selected).toHaveBeenCalledExactlyOnceWith(new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime());
    expect(mode === "obSingle" ? mock.evProfit : mock.ob).not.toHaveBeenCalled();
    expect(mock.ev).not.toHaveBeenCalled();
  });
  it.each([null, { role: "leader" }, { role: "user" }])("rejects non-admin callers at the service boundary", async (caller) => {
    await expect(getBetProfitAnalytics({ mode: "obSingle", period: "all" }, caller)).rejects.toThrow("无管理员权限");
    expect(mock.ob).not.toHaveBeenCalled(); expect(mock.ev).not.toHaveBeenCalled();
  });
  it("keeps original EV analytics scoped to the leader's team", async () => {
    await getValueBetOrderAnalytics({ month: "2026-11" }, { id: "leader", role: "leader", teamId: "t1" });
    expect(mock.ev).toHaveBeenCalledExactlyOnceWith(new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime(), ["u1"]);
    expect(mock.ob).not.toHaveBeenCalled();
  });
  it.each([null, { id: "u1", role: "user" }])("denies original EV analytics to ordinary or anonymous callers", async (caller) => {
    await expect(getValueBetOrderAnalytics({}, caller)).rejects.toThrow("无管理权限");
    expect(mock.ev).not.toHaveBeenCalled();
  });
  it("validates modes and reversed ranges before querying", async () => {
    await expect(getBetProfitAnalytics({ mode: "arbitrary" }, admin)).rejects.toThrow("请选择");
    await expect(getBetProfitAnalytics({ mode: "valueBet", startMs: 5, endMs: 1 }, admin)).rejects.toThrow("时间范围");
    expect(mock.ob).not.toHaveBeenCalled(); expect(mock.ev).not.toHaveBeenCalled();
  });
  it("supports all-history and exposes failures to the caller", async () => {
    const before = Date.now();
    const result = await getBetProfitAnalytics({ mode: "valueBet", period: "all" }, admin);
    expect(result.startMs).toBe(0); expect(result.endMs).toBeGreaterThan(before);
    mock.evProfit.mockRejectedValue(new Error("database unavailable"));
    await expect(getBetProfitAnalytics({ mode: "valueBet" }, admin)).rejects.toThrow("database unavailable");
  });
});
