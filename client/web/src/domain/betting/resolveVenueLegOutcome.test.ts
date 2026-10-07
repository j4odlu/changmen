import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { resolveVenueLegOutcome } from "./resolveVenueLegOutcome";

const getProvider = vi.hoisted(() => vi.fn());
const observeOrder = vi.hoisted(() => vi.fn());
vi.mock("@/services/orderObservation", () => ({ observeOrder }));

vi.mock("@/runtime/providers", () => ({
  getProvider,
}));

describe("resolveVenueLegOutcome", () => {
  beforeEach(() => {
    getProvider.mockReset();
    observeOrder.mockReset();
  });
  it.each(["matched", "delayed"])("starts detection at the actual settle entry only for PM %s", async status => {
    const result = Object.assign(new BetResult("Polymarket", true, "", undefined, { status }), {
      link: 123, observation: { ownerUserId: "u1", attemptId: "a1" }, pending: status === "delayed",
    });
    const outcome = { orders: [], settlement: "filled" };
    const resolveLegOutcome = vi.fn(async () => outcome);
    getProvider.mockReturnValue({ resolveLegOutcome });
    const fetch = vi.fn();
    expect(await resolveVenueLegOutcome({ provider: "Polymarket", accountId: 46 } as never, result, fetch)).toBe(outcome);
    expect(observeOrder).toHaveBeenCalledTimes(status === "delayed" ? 1 : 0);
    if (status === "delayed")
      expect(observeOrder).toHaveBeenCalledWith(result.observation, 123, "decision", expect.objectContaining({ reasonCode: "reject_detection_started" }));
    expect(resolveLegOutcome).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves the provider outcome and fetch ordering even if observation fails", async () => {
    observeOrder.mockImplementation(() => { throw new Error("observer failure"); });
    const outcome = { orders: [], settlement: "unfilled" };
    const resolveLegOutcome = vi.fn(async () => outcome);
    getProvider.mockReturnValue({ resolveLegOutcome });
    const result = new BetResult("RAY", true);
    const fetch = vi.fn();
    expect(await resolveVenueLegOutcome({ provider: "RAY" } as never, result, fetch, { rejectWaitSec: 30 })).toBe(outcome);
    expect(resolveLegOutcome).toHaveBeenCalledWith(expect.anything(), result, expect.objectContaining({ rejectWaitSec: 30 }));
    expect(result.success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with resolveLegOutcome skips entry pre-fetch; provider gets fetchVenueOrders", async () => {
    const resolveLegOutcome = vi.fn().mockResolvedValue({
      orders: [],
      settlement: "filled",
    });
    getProvider.mockReturnValue({ resolveLegOutcome });
    const fetchVenueOrders = vi.fn().mockResolvedValue([
      { orderId: "1", status: "none", createAt: 1 } as never,
    ]);

    const out = await resolveVenueLegOutcome(
      { provider: "OB" } as never,
      new BetResult("OB", true),
      fetchVenueOrders,
      { rejectWaitSec: 5 },
    );

    expect(fetchVenueOrders).not.toHaveBeenCalled();
    expect(resolveLegOutcome).toHaveBeenCalledWith(
      { provider: "OB" },
      expect.any(BetResult),
      expect.objectContaining({
        rejectWaitSec: 5,
        fetchVenueOrders: expect.any(Function),
      }),
    );
    expect(out.settlement).toBe("filled");
  });

  it("confirmPostAccepted fill-confirmed path: provider pull runs once when callback used", async () => {
    const fetchVenueOrders = vi.fn().mockResolvedValue([
      { orderId: "0xnew", status: "none", createAt: 2 } as never,
    ]);
    const resolveLegOutcome = vi.fn().mockImplementation(
      async (_acc, _result, opts: { fetchVenueOrders?: () => Promise<unknown[]> }) => {
        const orders = await opts.fetchVenueOrders?.() ?? [];
        return { orders, settlement: "filled" as const };
      },
    );
    getProvider.mockReturnValue({ resolveLegOutcome });

    const out = await resolveVenueLegOutcome(
      { provider: "Polymarket" } as never,
      Object.assign(new BetResult("Polymarket", true), { orderId: "0xnew" }),
      fetchVenueOrders,
      { confirmPostAccepted: true },
    );

    expect(fetchVenueOrders).toHaveBeenCalledTimes(1);
    expect(out.settlement).toBe("filled");
    expect(out.orders[0]?.orderId).toBe("0xnew");
  });

  it("falls back to orders[0] when provider has no resolveLegOutcome", async () => {
    getProvider.mockReturnValue({ getOrders: vi.fn() });
    const fetchVenueOrders = vi.fn().mockResolvedValue([
      { orderId: "1", status: "reject", createAt: 1, odds: 2, betMoney: 10 } as never,
    ]);

    const out = await resolveVenueLegOutcome(
      { provider: "HG" } as never,
      new BetResult("HG", true),
      fetchVenueOrders,
    );

    expect(fetchVenueOrders).toHaveBeenCalledTimes(1);
    expect(out.settlement).toBe("unfilled");
  });
});
