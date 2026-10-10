import { beforeEach, describe, expect, it, vi } from "vitest";
import { preserveOrderMode } from "../orderMetadata.js";
import { saveGtcOrders } from "./orders.js";

const mocks = vi.hoisted(() => ({ owned: vi.fn(), list: vi.fn(), scoped: vi.fn(), previous: vi.fn(), save: vi.fn() }));
vi.mock("@changmen/db", () => ({ listPmGtc: mocks.list, listPmGtcByIds: mocks.scoped, fetchOrdersByPlayerOrderIdsStrict: mocks.previous }));
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: mocks.owned }));
vi.mock("../../account/order_store.js", () => ({ saveOrder: mocks.save }));
const execution = { id: "execution", plan: { playerId: 1, orderHash: "original", otherPlayerId: 2 }, other: {} };
const body = (row = {}) => ({ playerId: 1, type: "Polymarket", orders: JSON.stringify([{ orderId: "original", provider: "Polymarket", pmGtcExecutionId: "execution", ...row }]) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.owned.mockResolvedValue({ ok: true, player: { provider: "Polymarket" } });
  mocks.list.mockRejectedValue(new Error("unrelated historical repair failed")); mocks.scoped.mockResolvedValue([execution]); mocks.previous.mockResolvedValue([]); mocks.save.mockResolvedValue(true);
});
describe("GTC endpoint validates identity before using the shared writer", () => {
  it("the owned original receives a trusted identity before native saving", async () => {
    expect(await saveGtcOrders(body(), "owner")).toEqual({ ok: true, info: true });
    expect(mocks.scoped).toHaveBeenCalledExactlyOnceWith("owner", ["execution"]);
    expect(mocks.list).not.toHaveBeenCalled();
    const [playerId, rows, owner, provider] = mocks.save.mock.calls[0];
    expect([playerId, owner, provider]).toEqual([1, "owner", "Polymarket"]);
    const raw = {}; preserveOrderMode(raw, {}, rows[0], new Map());
    expect(raw.pmGtcExecutionId).toBe("execution");
  });
  it("a different original cannot acquire trusted GTC metadata", async () => {
    expect(await saveGtcOrders(body({ orderId: "unrelated" }), "owner")).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("owner rejection does not read executions or invoke the shared writer", async () => {
    mocks.owned.mockResolvedValue({ ok: false, msg: "无权访问" });
    expect(await saveGtcOrders(body(), "other-owner")).toMatchObject({ ok: false });
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.scoped).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("a foreign or missing execution cannot be saved through scoped lookup", async () => {
    mocks.scoped.mockResolvedValue([]);
    expect(await saveGtcOrders(body(), "owner")).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("ordinary writer failure remains a failed GTC save", async () => {
    mocks.save.mockResolvedValue(false);
    expect(await saveGtcOrders(body(), "owner")).toEqual({ ok: false, msg: "GTC 保存订单失败" });
  });
});
