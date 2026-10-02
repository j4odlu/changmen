import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupOrderLogs, toAdminOrderLogPayload } from "./user_log_lookup.js";

const mocks = vi.hoisted(() => ({ observations: vi.fn(), orders: vi.fn(), logs: vi.fn() }));
vi.mock("@changmen/db", () => ({
  fetchUserById: async id => ({ id, user_name: "test" }),
  fetchUserByName: vi.fn(),
  fetchOrdersByLink: mocks.orders,
  fetchOrderObservations: mocks.observations,
  fetchOrderByOrderId: vi.fn(),
  fetchFootballOrderByVenueOrderId: vi.fn(),
  fetchBettingUserLogsInRange: mocks.logs,
}));

describe("没有订单的精确执行诊断", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orders.mockResolvedValue([]);
    mocks.observations.mockResolvedValue({ status: "available", truncated: false, events: [
      { kind: "execution_started", executionId: "execution-123", eventId: "event-123", ownerUserId: "u1", sequence: 1, occurredAt: 1000, linkId: 123 },
    ] });
  });
  it("reads exact Link evidence without manufacturing orders or using time-window guesses", async () => {
    const result = await lookupOrderLogs({ userId: "u1", link: 123 });
    expect(result.ok).toBe(true);
    expect(result.orders).toEqual([]);
    expect(mocks.observations).toHaveBeenCalledWith("u1", 123, 2000, [], {});
    expect(mocks.logs).not.toHaveBeenCalled();
    expect(toAdminOrderLogPayload(result).observation.events).toHaveLength(1);
  });
  it("keeps execution lookup scoped to the requested user and ID", async () => {
    const result = await lookupOrderLogs({ userId: "u2", executionId: "execution-123" });
    expect(result.ok).toBe(true);
    expect(mocks.observations).toHaveBeenCalledWith("u2", 0, 2000, [], { executionId: "execution-123" });
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and fractional Links before querying evidence", async () => {
    expect((await lookupOrderLogs({ userId: "u1", executionId: "' OR 1=1" })).ok).toBe(false);
    expect((await lookupOrderLogs({ userId: "u1", link: 1.5 })).ok).toBe(false);
    expect(mocks.observations).not.toHaveBeenCalled();
  });
  it("does not turn unavailable or missing observations into success", async () => {
    mocks.observations.mockResolvedValue({ status: "unavailable", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
    mocks.observations.mockResolvedValue({ status: "available", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
  });
});
