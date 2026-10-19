import { describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isA8VenueReject, resolveA8VenueLegOutcome } from "./a8LegOutcome";

describe("a8LegOutcome", () => {
  it("isA8VenueReject uses orders[0]", () => {
    expect(isA8VenueReject([
      { status: "reject" } as never,
      { status: "none" } as never,
    ])).toBe(true);
    expect(isA8VenueReject([{ status: "none" } as never])).toBe(false);
  });

  it("resolveA8VenueLegOutcome ignores result.orderId", async () => {
    const provider = {
      getOrders: vi.fn().mockResolvedValue([
        { orderId: "stale", status: "reject", createAt: 2 } as never,
        { orderId: "new", status: "none", createAt: 1 } as never,
      ]),
    };

    const out = await resolveA8VenueLegOutcome(
      provider,
      { provider: "OB" } as never,
      Object.assign(new BetResult("OB", true), { orderId: "new" }),
    );

    expect(out.settlement).toBe("unfilled");
  });

  it("waits rejectWaitSec before pulling orders", async () => {
    vi.useFakeTimers();
    const getOrders = vi.fn().mockResolvedValue([{ status: "reject", createAt: 1 } as never]);
    const provider = { getOrders };

    const pending = resolveA8VenueLegOutcome(
      provider,
      { provider: "OB" } as never,
      undefined,
      { rejectWaitSec: 3 },
    );
    await vi.advanceTimersByTimeAsync(2999);
    expect(getOrders).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(getOrders).toHaveBeenCalledTimes(1);
    expect(out.settlement).toBe("unfilled");
    vi.useRealTimers();
  });

  it("prefers fetchVenueOrders after wait; does not use stale opts.orders", async () => {
    vi.useFakeTimers();
    const fetchVenueOrders = vi.fn().mockResolvedValue([
      { status: "reject", createAt: 2 } as never,
    ]);
    const getOrders = vi.fn().mockResolvedValue([
      { status: "none", createAt: 1 } as never,
    ]);
    const provider = { getOrders };

    const pending = resolveA8VenueLegOutcome(
      provider,
      { provider: "RAY" } as never,
      undefined,
      {
        rejectWaitSec: 2,
        orders: [{ status: "none", createAt: 1 } as never],
        fetchVenueOrders,
      },
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchVenueOrders).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(fetchVenueOrders).toHaveBeenCalledTimes(1);
    expect(getOrders).not.toHaveBeenCalled();
    expect(out.settlement).toBe("unfilled");
    vi.useRealTimers();
  });

  it("uses opts.orders when fetchVenueOrders is absent (no uncertain re-poll)", async () => {
    const getOrders = vi.fn();
    const out = await resolveA8VenueLegOutcome(
      { getOrders },
      { provider: "OB" } as never,
      undefined,
      { orders: [{ status: "none", createAt: 1 } as never] },
    );
    expect(getOrders).not.toHaveBeenCalled();
    expect(out.settlement).toBe("filled");
  });

  it("keeps first none snapshot as filled (A8 一次拉单)", async () => {
    const fetchVenueOrders = vi.fn()
      .mockResolvedValueOnce([{ status: "none", createAt: 1 } as never])
      .mockResolvedValueOnce([{ status: "reject", createAt: 2 } as never]);

    const out = await resolveA8VenueLegOutcome(
      { getOrders: vi.fn() },
      { provider: "RAY" } as never,
      undefined,
      { rejectWaitSec: 0, fetchVenueOrders },
    );
    expect(fetchVenueOrders).toHaveBeenCalledTimes(1);
    expect(out.settlement).toBe("filled");
  });

  it("empty list is one pull then filled", async () => {
    const getOrders = vi.fn().mockResolvedValue([]);
    const out = await resolveA8VenueLegOutcome(
      { getOrders },
      { provider: "OB" } as never,
      undefined,
      { rejectWaitSec: 0 },
    );
    expect(getOrders).toHaveBeenCalledTimes(1);
    expect(out.settlement).toBe("filled");
  });
});
