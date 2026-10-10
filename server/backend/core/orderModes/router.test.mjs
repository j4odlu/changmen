import { beforeEach, describe, expect, it, vi } from "vitest";
import { partitionClientOrders } from "./identity.js";
import { getOrders, saveOrders } from "./router.js";

const mocks = vi.hoisted(() => ({ oldSave: vi.fn(), oldRead: vi.fn(), identities: vi.fn(), previous: vi.fn() }));
vi.mock("@changmen/db", () => ({ fetchOrderExecutionIdentities: mocks.identities, fetchOrdersByPlayerOrderIdsStrict: mocks.previous }));
vi.mock("../account/account_service.js", () => ({ handleSaveOrder: mocks.oldSave, handleGetOrderList: mocks.oldRead }));
beforeEach(() => vi.resetAllMocks());
describe("ordinary endpoints have no GTC coordinator dependency", () => {
  it("exports the original handlers themselves", () => {
    expect(getOrders).toBe(mocks.oldRead); expect(saveOrders).toBe(mocks.oldSave);
  });
  it("forwards a FOK save with its original object and response", async () => {
    const body = { playerId: 1, orders: JSON.stringify([{ orderId: "fok" }]) };
    const result = { ok: true, info: true }; mocks.oldSave.mockResolvedValue(result);
    expect(await saveOrders(body, "owner")).toBe(result);
    expect(mocks.oldSave).toHaveBeenCalledExactlyOnceWith(body, "owner");
    expect(mocks.identities).not.toHaveBeenCalled(); expect(mocks.previous).not.toHaveBeenCalled();
  });
  it("returns mixed ordinary rows without querying executions or changing pagination", async () => {
    const result = { ok: true, info: { list: [{ OrderID: "fok" }, { OrderID: "gtc", PmGtcExecutionId: "execution" }], total: 2 } };
    mocks.oldRead.mockResolvedValue(result); mocks.identities.mockReturnValue(new Promise(() => {}));
    expect(await getOrders({ date: "2026-10-10" }, "owner")).toBe(result);
    expect(mocks.identities).not.toHaveBeenCalled(); expect(mocks.previous).not.toHaveBeenCalled();
  });
  it("unavailable GTC coordination cannot reject an ordinary save", async () => {
    mocks.identities.mockRejectedValue(new Error("unavailable"));
    mocks.previous.mockRejectedValue(new Error("extra read unavailable"));
    const result = { ok: true, info: true }; mocks.oldSave.mockResolvedValue(result);
    expect(await saveOrders({ playerId: 1, orders: "[]" }, "owner")).toBe(result);
    expect(mocks.identities).not.toHaveBeenCalled(); expect(mocks.previous).not.toHaveBeenCalled();
  });
  it("preserves native validation and read failure results", async () => {
    const result = { ok: false, msg: "保存订单失败" }; mocks.oldSave.mockResolvedValue(result);
    expect(await saveOrders({ orders: "invalid" }, "owner")).toBe(result);
    const read = { ok: false, msg: "读取失败" }; mocks.oldRead.mockResolvedValue(read);
    expect(await getOrders({}, "owner")).toBe(read);
  });
  it("historical counterpart identity remains player/provider scoped", () => {
    const records = [{ id: "execution", plan: { playerId: 1, otherPlayerId: 2, otherProvider: "PredictFun" }, other: { orderId: "PF-buy" } }];
    const own = { OrderID: "PF-buy", PlayerID: 2, Type: "PredictFun" };
    const sell = { OrderID: "sell", PlayerID: 2, Type: "PredictFun", PfBuyOrderId: "PF-buy" };
    const unrelated = { ...own, PlayerID: 3 };
    expect(partitionClientOrders([own, sell, unrelated], records)).toEqual({ fok: [unrelated], gtc: [{ ...own, PmGtcExecutionId: "execution" }, { ...sell, PmGtcExecutionId: "execution" }] });
  });
});
