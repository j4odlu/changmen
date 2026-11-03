import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeOrderLogicalSave, rowToOrder, saveOrder, saveOrderBind } from "./order_store.js";

const db = vi.hoisted(() => ({
  fetchOrdersByPlayerOrderIdsStrict: vi.fn(), upsertOrders: vi.fn(), updateOrderBind: vi.fn(),
}));
vi.mock("@changmen/db", async (original) => ({ ...await original(), ...db }));
const market = { matchId: 17, betId: 22, round: 3, game: "CS2", matchTitle: "A vs B", betName: "[地图3] 获胜" };

beforeEach(() => {
  vi.clearAllMocks(); db.fetchOrdersByPlayerOrderIdsStrict.mockResolvedValue([]);
  db.upsertOrders.mockResolvedValue(true); db.updateOrderBind.mockResolvedValue(true);
});

describe("persisted order market identity", () => {
  it("writes a new order and returns its strategy identity separately from native labels", async () => {
    await saveOrder(7, [{ provider: "Polymarket", orderId: "pm-1", createAt: 1700000000000,
      match: "A vs B", bet: "全场", item: "A", clientMarket: market }], "owner");
    const [row] = db.upsertOrders.mock.calls[0][0];
    expect(row.raw.clientMarket).toEqual(market);
    expect(rowToOrder(row)).toMatchObject({ ClientMarket: market, Bet: "全场" });
  });
  it.each(["OB", "Polymarket", "PredictFun"])("retains %s identity when a later venue sync omits or contradicts it", (provider) => {
    const previous = { provider, raw: { clientMarket: market } };
    for (const clientMarket of [undefined, null, { ...market, matchId: 99 }]) {
      const result = mergeOrderLogicalSave(previous, previous.raw, { provider, clientMarket });
      expect(result.raw.clientMarket).toEqual(market);
    }
  });
  it("does not fabricate identity from old order names", () => {
    expect(rowToOrder({ match: "A vs B", bet: "[地图3] 获胜", raw: {} })).not.toHaveProperty("ClientMarket");
  });
  it("validates metadata and sends the owner and exact account to binding", async () => {
    expect(await saveOrderBind([{ OrderID: "o1", PlayerID: 7, Provider: "OB", LinkID: 1700000000000,
      ClientMarket: market }], "owner")).toBe(true);
    expect(db.updateOrderBind).toHaveBeenCalledWith("o1", "owner", 1700000000000, { playerId: 7, provider: "OB", clientMarket: market });
    db.updateOrderBind.mockClear();
    expect(await saveOrderBind([{ OrderID: "o1", LinkID: 1, ClientMarket: { ...market, round: "3" } }], "owner")).toBe(false);
    expect(db.updateOrderBind).not.toHaveBeenCalled();
  });
  it.each(["Polymarket", "PredictFun"])("copies %s sell metadata from the exact parent buy", async (provider) => {
    const prefix = provider === "Polymarket" ? "pm" : "pf";
    db.fetchOrdersByPlayerOrderIdsStrict.mockResolvedValue([{ provider, order_id: "buy", player_id: 7,
      user_id: "owner", link: 1700000000000, raw: { clientMarket: market } }]);
    await saveOrder(7, [{ provider, orderId: "sell", createAt: 1700000000001,
      [`${prefix}Side`]: "sell", [`${prefix}BuyOrderId`]: "buy" }], "owner");
    expect(db.upsertOrders.mock.calls[0][0][0].raw.clientMarket).toEqual(market);
  });
});
