import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshGtcOrders, saveOrders } from "./ordersApi";

const mock = vi.hoisted(() => ({ post: vi.fn(), fetch: vi.fn(), date: "2026-10-09" }));
vi.mock("@/api/client", () => ({ post: mock.post, unwrap: (value: unknown) => value }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ fetchOrders: mock.fetch, orderDate: mock.date }) }));
beforeEach(() => { vi.clearAllMocks(); mock.fetch.mockResolvedValue(true); mock.post.mockResolvedValue({ success: 1, info: true }); });
describe("gTC results feed the ordinary order pipeline", () => {
  it("refreshes the common order list rather than fetching a second GTC list", async () => {
    await refreshGtcOrders("2026-10-10");
    expect(mock.fetch).toHaveBeenCalledExactlyOnceWith("2026-10-10"); expect(mock.post).not.toHaveBeenCalled();
  });
  it("preserves the user's selected date when GTC recovery refreshes ordinary orders", async () => {
    await refreshGtcOrders(); expect(mock.fetch).toHaveBeenCalledExactlyOnceWith(mock.date);
  });
  it("saves GTC execution snapshots through the identity-checked GTC writer", async () => {
    const account = { accountId: 1, provider: "Polymarket" } as PlatformAccount;
    const rows: (VenueOrder & { pmGtcExecutionId: string })[] = [{ orderId: "buy", provider: "Polymarket", pmGtcExecutionId: "execution", odds: 2, createAt: Date.now(), betMoney: 5, reward: 0, money: 0, status: "none", game: "CS2", match: "match", bet: "winner", item: "Home" }];
    await saveOrders(account, rows);
    expect(mock.post).toHaveBeenCalledExactlyOnceWith("Pm_GtcSaveOrders", { type: "Polymarket", playerId: 1, orders: JSON.stringify(rows) });
  });
});
