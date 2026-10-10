import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow } from "@/types/order";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { useOrderStore as useFokExecutionOrders } from "./fok/financialOrders";

const mocks = vi.hoisted(() => ({ read: vi.fn(), report: vi.fn() }));
vi.mock("@/api/order", () => ({ getOrderList: mocks.read }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ orderReportMessage: mocks.report }) }));
vi.mock("@/stores/account/pmManualSell", () => ({ resumePmManualSellClosings: vi.fn() }));
const now = Date.now();
const fok: OrderRow = { OrderID: "fok", PlayerID: 1, Type: "OB", Link: -now, CreateAt: now, Status: "Win", BetMoney: 100, Money: 2 };
const gtc: OrderRow = { OrderID: "gtc", PlayerID: 1, Type: "Polymarket", Link: -now - 1, CreateAt: now, Status: "Win", PmSide: "buy", PmGtcExecutionId: "execution", PmShares: 9.29, PmFillPrice: 0.78, PmStakeUsdc: 7.3259, BetMoney: 7.3259 * 6.7, Money: 13 };
beforeEach(() => {
  vi.clearAllMocks(); setActivePinia(createPinia()); useUserStore().userId = 101;
  useAccountStore().accounts = [{ accountId: 1, provider: "Polymarket", balance: 100 }] as PlatformAccount[];
});
describe("execution modes share ordinary orders, statistics and reports", () => {
  it("counts both buys once and sends one ordinary report with both original rows", async () => {
    mocks.read.mockResolvedValue({ list: [fok, gtc], total: 2 });
    const orders = useOrderStore(); await orders.fetchOrders();
    expect([...orders.orders.values()].flat().map(row => row.OrderID)).toEqual(expect.arrayContaining(["fok", "gtc"]));
    expect([...orders.orders.values()].flat()).toHaveLength(2);
    expect(useAccountStore().accounts[0]?.orderCount).toBe(2);
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.report.mock.calls[0]![1].map((row: OrderRow) => row.OrderID).sort()).toEqual(["fok", "gtc"]);
  });
  it("gTC sells remain attached to their buy and never count as a second bet", () => {
    useOrderStore().updateTodayProfit([gtc, { ...gtc, OrderID: "sell", PmSide: "sell", PmBuyOrderId: "gtc", Money: 0 }]);
    expect(useAccountStore().accounts[0]?.orderCount).toBe(1);
  });
  it("fOK automatic sell scanners receive only FOK while the common list retains both modes", () => {
    const ordinary = useOrderStore(); ordinary.orders = new Map([[fok.Link!, [fok]], [gtc.Link!, [gtc]]]);
    expect([...useFokExecutionOrders().orders.values()].flat()).toEqual([fok]);
    expect([...ordinary.orders.values()].flat()).toEqual([fok, gtc]);
  });
  it("the FOK execution boundary preserves the original map when no GTC exists", () => {
    const ordinary = useOrderStore(); ordinary.orders = new Map([[fok.Link!, [fok]]]);
    expect(useFokExecutionOrders().orders).toBe(ordinary.orders);
  });
});
