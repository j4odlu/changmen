import { beforeEach, expect, it, vi } from "vitest";
import { rayProvider } from "@changmen/venue-browser/adapter/ray/bet";
import { PlatformAccount } from "@/models/platformAccount";
import { saveOrders } from "./order";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/ray/accountHttp", () => ({ accountGet: mocks.get, accountPostForm: vi.fn() }));
vi.mock("@/api/client", () => ({ post: mocks.post, unwrap: (value: unknown) => value }));
beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue({ success: 1 }); });

it("carries the RAY native id from its real adapter through the ordinary save payload without replacing orderId", async () => {
  const account = new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" });
  mocks.get.mockResolvedValue({ code: 200, result: [{ id: 394004085, order_number: "R-1", status: 0,
    create_time: "2026-11-10 07:49:11", detail: [{ title: "获胜者\nAway", odds: 2.21, stake: 91 }] }] });
  const orders = await rayProvider.getOrders!(account);
  await saveOrders(account, orders);
  expect(mocks.post).toHaveBeenCalledOnce();
  const [action, payload] = mocks.post.mock.calls[0]!;
  expect(action).toBe("Client_SaveOrder");
  expect(payload).toMatchObject({ type: "RAY", playerId: 2 });
  expect(JSON.parse(payload.orders)).toEqual([expect.objectContaining({
    orderId: "R-1", rayInternalOrderId: "394004085", status: "none", betMoney: 91, odds: 2.21, money: 0,
  })]);
});
