import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { BetResult } from "@changmen/client-core/models/betResult";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindArbLegOrder, bindArbOrderId, resolveArbBindOrderId } from "./arbOrderBind";

const saveOrderBind = vi.hoisted(() => vi.fn());
const wait = vi.hoisted(() => vi.fn(async () => {}));
const observeOrder = vi.hoisted(() => vi.fn());
vi.mock("@/services/orderObservation", () => ({ observeOrder }));

vi.mock("@/api/esport", () => ({ saveOrderBind }));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));

function makeVenueOrder(
  partial: Pick<VenueOrder, "orderId" | "status" | "odds" | "betMoney">,
): VenueOrder {
  return {
    provider: "RAY",
    createAt: 0,
    reward: 0,
    money: 0,
    game: "",
    match: "",
    bet: "",
    item: "",
    ...partial,
  };
}

describe("resolveArbBindOrderId", () => {
  it("prefers result.orderId for success legs", () => {
    const result = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xd695a0c4cdd10b558fc829ecda52f20eeca76407",
    });
    const orders = [
      makeVenueOrder({ orderId: "0xfe933cac68e49da172f4ab8e59e6c1", status: "none", odds: 2.6, betMoney: 98 }),
    ];
    expect(resolveArbBindOrderId(orders, result)).toBe("0xd695a0c4cdd10b558fc829ecda52f20eeca76407");
  });

  it("success A8 leg prefers result.orderId over orders[0]", () => {
    const result = Object.assign(new BetResult("OB", true), {
      orderId: "from-result",
    });
    const orders = [
      makeVenueOrder({ orderId: "ob-1", status: "none", odds: 2, betMoney: 100 }),
    ];
    expect(resolveArbBindOrderId(orders, result)).toBe("from-result");
  });

  it("rejected leg binds orders[0] when result orderId missing from list", () => {
    const result = Object.assign(new BetResult("RAY", true), {
      orderId: "missing",
    });
    const orders = [
      makeVenueOrder({ orderId: "ray-reject", status: "reject", odds: 1.76, betMoney: 170 }),
    ];
    expect(resolveArbBindOrderId(orders, result, true)).toBe("ray-reject");
  });

  it("binds orders[0] when list non-empty and no result orderId", () => {
    const orders = [
      makeVenueOrder({ orderId: "bind-1", status: "none", odds: 2, betMoney: 100 }),
    ];
    expect(resolveArbBindOrderId(orders, undefined)).toBe("bind-1");
    expect(resolveArbBindOrderId([], undefined)).toBeUndefined();
  });
});

describe("bindArbLegOrder", () => {
  beforeEach(() => {
    saveOrderBind.mockReset();
    wait.mockClear();
    observeOrder.mockReset();
  });

  it("retries then succeeds", async () => {
    saveOrderBind
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = Object.assign(new BetResult("OB", true), { orderId: "ob-1" });
    const ok = await bindArbLegOrder(
      1_700_000_000_000,
      { accountId: 1 } as never,
      result,
      [makeVenueOrder({ orderId: "ob-1", status: "none", odds: 2, betMoney: 100 })],
      false,
    );
    expect(ok).toBe(true);
    expect(saveOrderBind).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("returns the actual binding acknowledgement when observation throws", async () => {
    saveOrderBind.mockResolvedValue(true);
    observeOrder.mockImplementation(() => { throw new Error("observer failure"); });
    const result = Object.assign(new BetResult("OB", true), { orderId: "ob-1" });
    expect(await bindArbLegOrder(1700, { accountId: 1 } as never, result, [], false)).toBe(true);
    expect(saveOrderBind).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("returns false after retries exhausted", async () => {
    saveOrderBind.mockResolvedValue(false);
    const result = Object.assign(new BetResult("OB", true), { orderId: "ob-1" });
    const ok = await bindArbLegOrder(
      1_700_000_000_000,
      { accountId: 1 } as never,
      result,
      [makeVenueOrder({ orderId: "ob-1", status: "none", odds: 2, betMoney: 100 })],
      false,
    );
    expect(ok).toBe(false);
    expect(saveOrderBind).toHaveBeenCalledTimes(3);
  });

  it("binds a known delayed venue order id", async () => {
    saveOrderBind.mockResolvedValue(true);
    const ok = await bindArbOrderId(100, "RAY", 2, "ray-late");
    expect(ok).toBe(true);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([{
        LinkID: 100,
        Provider: "RAY",
        PlayerID: 2,
        OrderID: "ray-late",
      }]),
    });
  });
});
