import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrderObservations, insertOrderObservations } from "./order_observation_store.js";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mocks.query }) }));
describe("独立观察表", () => {
  beforeEach(() => { mocks.query.mockReset(); });
  it("deduplicates by user/event and only acknowledges the identical stored payload", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ event_id: "event-1" }] });
    expect(await insertOrderObservations("u1", [{ eventId: "event-1" }])).toEqual(["event-1"]);
    expect(mocks.query.mock.calls[0][0]).toContain("ON CONFLICT (user_id,event_id) DO NOTHING");
    expect(mocks.query.mock.calls[1][0]).toContain("o.event=e");
  });
  it("does not write orders and preserves the original diagnostic when the table is unavailable", async () => {
    mocks.query.mockImplementation(async () => { throw new Error("missing table"); });
    expect(await fetchOrderObservations("u1", 123)).toEqual({ status: "unavailable", events: [], truncated: false });
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/UPDATE|INSERT/);
  });
  it("never selects all unbound events for Link zero", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await fetchOrderObservations("u1", 0, 2000, [{ provider: "OB", accountId: "1", orderId: "o1" }]);
    expect(mocks.query.mock.calls[0][0]).toContain("$2::bigint <> 0");
    expect(mocks.query.mock.calls[0][0]).toContain("event->>'accountId'=ref->>'accountId'");
  });
});
