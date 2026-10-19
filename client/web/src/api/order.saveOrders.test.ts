import type { VenueOrder } from "@changmen/client-core/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";

const post = vi.hoisted(() => vi.fn(async () => ({ success: 1, info: true })));

vi.mock("@/api/client", () => ({
  post,
  unwrap: <T>(data: { info?: T }) => data.info as T,
}));

describe("saveOrders PredictFun guard", () => {
  beforeEach(() => {
    post.mockClear();
  });

  it("skips Client_SaveOrder for PredictFun account", async () => {
    const { saveOrders } = await import("./order");
    const account = new PlatformAccount({
      accountId: 42,
      playerName: "pf",
      provider: "PredictFun",
    });
    const orders: VenueOrder[] = [{
      orderId: "1",
      provider: "PredictFun",
      status: "none",
      createAt: 0,
      reward: 0,
      money: 0,
      odds: 2,
      betMoney: 10,
      game: "",
      match: "",
      bet: "",
      item: "",
      pfHoldShares: 99,
    }];
    await saveOrders(account, orders);
    expect(post).not.toHaveBeenCalled();
  });

  it("still saves non-PF providers", async () => {
    const { saveOrders } = await import("./order");
    const account = new PlatformAccount({
      accountId: 7,
      playerName: "ray",
      provider: "RAY",
    });
    await saveOrders(account, [{
      orderId: "r1",
      provider: "RAY",
      status: "none",
      createAt: 0,
      reward: 0,
      money: 0,
      odds: 2,
      betMoney: 10,
      game: "",
      match: "",
      bet: "",
      item: "",
    }]);
    expect(post).toHaveBeenCalledWith("Client_SaveOrder", expect.objectContaining({
      type: "RAY",
      playerId: 7,
    }));
  });
});
