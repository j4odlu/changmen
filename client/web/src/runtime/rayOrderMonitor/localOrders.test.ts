import type { VenueOrder } from "@changmen/client-core/contract";
import type { OrderRow } from "@/types/order";
import { beforeEach, expect, it, vi } from "vitest";
import { updateRayOrdersLocally } from "./localOrders";
const mock = vi.hoisted(() => ({ orders: new Map<number, OrderRow[]>(), profit: vi.fn() }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mock.orders, updateTodayProfit: mock.profit }) }));
beforeEach(() => { mock.orders.clear(); vi.clearAllMocks(); });
it("updates only the matching RAY account and preserves stored identity and financial metadata", () => {
  const row: OrderRow = { Type: "RAY", PlayerID: 2, OrderID: "one", Status: "None", Link: 123, CreateAt: 456,
    PmGtcExecutionId: "gtc", PodClientId: "ticket", Money: 0, BetMoney: 70, Odds: 2 };
  mock.orders.set(123, [row, { ...row, PlayerID: 3 }, { ...row, Type: "OB" }]);
  updateRayOrdersLocally(2, [{ provider: "RAY", orderId: "one", status: "win", money: 70, betMoney: 70, odds: 2,
    createAt: 999, link: 999 } as VenueOrder]);
  expect(row).toMatchObject({ Status: "Win", Money: 70, Link: 123, CreateAt: 456, PmGtcExecutionId: "gtc", PodClientId: "ticket" });
  expect(mock.orders.get(123)?.slice(1).map(r => r.Status)).toEqual(["None", "None"]);
  expect(mock.profit).toHaveBeenCalledOnce();
});
it("never creates an unrelated order or regresses a terminal state", () => {
  const row: OrderRow = { Type: "RAY", PlayerID: 2, OrderID: "one", Status: "Win", Money: 70 };
  mock.orders.set(123, [row]);
  updateRayOrdersLocally(2, [{ provider: "RAY", orderId: "one", status: "none", money: 0 } as VenueOrder,
    { provider: "RAY", orderId: "new", status: "reject" } as VenueOrder]);
  expect(mock.orders.get(123)).toEqual([row]); expect(row).toMatchObject({ Status: "Win", Money: 70 });
  expect(mock.profit).not.toHaveBeenCalled();
});
