import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupOrderLogs, toAdminOrderLogPayload } from "./user_log_lookup.js";

const mocks = vi.hoisted(() => ({ observations: vi.fn(), orders: vi.fn(), linkedOrders: vi.fn(), logs: vi.fn() }));
vi.mock("@changmen/db", () => ({
  fetchUserById: async id => ({ id, user_name: "test" }),
  fetchUserByName: vi.fn(),
  fetchOrdersByLink: mocks.orders,
  fetchOrdersByLinks: mocks.linkedOrders,
  fetchOrderObservations: mocks.observations,
  fetchOrderByOrderId: vi.fn(),
  fetchFootballOrderByVenueOrderId: vi.fn(),
  fetchBettingUserLogsInRange: mocks.logs,
}));

describe("没有订单的精确执行诊断", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orders.mockResolvedValue([]);
    mocks.linkedOrders.mockResolvedValue([]);
    mocks.logs.mockResolvedValue({ rows: [], truncated: false, limit: 1000 });
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
  it("reads an exact evidence record without searching legacy logs", async () => {
    const result = await lookupOrderLogs({ userId: "u1", eventId: "event-123" });
    expect(result.ok).toBe(true);
    expect(mocks.observations).toHaveBeenCalledWith("u1", 0, 2000, [], { eventId: "event-123" });
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("does not turn unavailable or missing observations into success", async () => {
    mocks.observations.mockResolvedValue({ status: "unavailable", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
    mocks.observations.mockResolvedValue({ status: "available", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
  });
  const order = { order_id: "pm-original", provider: "Polymarket", player_id: 7, link: 123, status: "None", create_at: 1000,
    odds: 1.9, bet_money: 100, money: 0, raw: { pmShares: 10, token: "secret" } };
  const submit = { version: 1, kind: "submission_result", executionId: "execution-123", attemptId: "attempt-123", eventId: "submit-123",
    ownerUserId: "u1", sequence: 1, occurredAt: 1000, linkId: 123, provider: "Polymarket", accountId: 7,
    orderId: "pm-original", observedStatus: "delayed", outcome: "accepted", source: "adapter_result" };
  it("the ordinary diagnostic button can read direct decisions and current orders without scanning old logs", async () => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: false });
    const payload = toAdminOrderLogPayload(await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: true }));
    expect(payload).toMatchObject({ diagnosticSource: "events", legacyLogsLoaded: false, ordersQueried: true });
    expect(payload.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(payload.orders).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "empty"])("falls back to the existing diagnostic logs when observations are %s", async status => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: status === "empty" ? "available" : status, events: [], truncated: false });
    const payload = await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: true });
    expect(payload).toMatchObject({ ok: true, diagnosticSource: "legacy", legacyLogsLoaded: true });
    expect(mocks.logs).toHaveBeenCalledOnce();
  });
  it("allows old logs to be requested explicitly without replacing the direct records", async () => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: false });
    const result = await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: false });
    expect(result.legacyLogsLoaded).toBe(true);
    expect(result.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(mocks.logs).toHaveBeenCalledOnce();
  });
  it("exact execution queries load current orders in one user-scoped batch and reject other account identities", async () => {
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: true });
    mocks.linkedOrders.mockResolvedValue([order, { ...order, player_id: 8 }, { ...order, provider: "RAY" }, { ...order, link: 999 }]);
    const result = await lookupOrderLogs({ userId: "u1", executionId: "execution-123", preferDirect: true });
    expect(mocks.linkedOrders).toHaveBeenCalledWith("u1", [123]);
    expect(result.orders).toHaveLength(1);
    expect(result.observation.truncated).toBe(true);
    expect(result.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(mocks.logs).not.toHaveBeenCalled();
  });
});
