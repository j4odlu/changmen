import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderObservationOutbox } from "./orderObservationOutbox";

function event(id: string, ownerUserId = "u1"): OrderObservationEvent {
  return { version: 1, eventId: id, ownerUserId, kind: "submission_started", occurredAt: 1000, sequence: 1, linkId: 123, attemptId: "attempt-1" };
}
describe("旁路上传故障隔离", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does no I/O on enqueue and retries the same event ID after failure", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    const write = vi.fn();
    const queue = new OrderObservationOutbox({ owner: () => "u1", send, read: () => null, write });
    queue.enqueue(event("event-001"));
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await queue.flush();
    await queue.flush();
    expect(send.mock.calls.map(call => call[1][0].eventId)).toEqual(["event-001", "event-001"]);
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("pauses events owned by another user and restores the original IDs", async () => {
    let owner = "u2";
    const send = vi.fn(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    const queue = new OrderObservationOutbox({ owner: () => owner, send, read: () => JSON.stringify([event("event-001")]), write: () => {} });
    await queue.flush();
    expect(send).not.toHaveBeenCalled();
    owner = "u1";
    await queue.flush();
    expect(send.mock.calls[0]![0]).toBe("u1");
    expect(send.mock.calls[0]![1][0].eventId).toBe("event-001");
  });

  it("storage failure and overflow produce gap evidence without throwing", async () => {
    const send = vi.fn(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    const queue = new OrderObservationOutbox({ owner: () => "u1", send, read: () => null, write: () => { throw new Error("quota"); }, capacity: 1 });
    expect(() => { queue.enqueue(event("event-001")); queue.enqueue(event("event-002")); }).not.toThrow();
    await queue.flush();
    const rows = send.mock.calls[0]![1];
    expect(rows.some((row: OrderObservationEvent) => row.kind === "transport_gap")).toBe(true);
    expect(rows.some((row: OrderObservationEvent) => row.eventId === "event-001")).toBe(true);
    expect(rows.some((row: OrderObservationEvent) => row.eventId === "event-002")).toBe(false);
  });

  it("an acknowledgement cannot remove an event outside the sent batch", async () => {
    const send = vi.fn(async () => ["event-u2"]);
    let saved = "";
    const queue = new OrderObservationOutbox({ owner: () => "u1", send, read: () => null, write: (value) => { saved = value; } });
    queue.enqueue(event("event-001"));
    queue.enqueue(event("event-u2", "u2"));
    await queue.flush();
    expect(JSON.parse(saved).map((row: OrderObservationEvent) => row.eventId)).toContain("event-u2");
  });

  it("corrupt persisted rows cannot poison the next upload batch", async () => {
    const send = vi.fn(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    const queue = new OrderObservationOutbox({ owner: () => "u1", send, read: () => JSON.stringify([{ version: 1, eventId: "bad", ownerUserId: "u1" }, event("event-001"), event("event-001")]), write: () => {} });
    await queue.flush();
    expect(send.mock.calls[0]![1].map((row: OrderObservationEvent) => row.eventId)).toEqual(["event-001"]);
  });

  it("bounds restored events and reports the discarded evidence", async () => {
    const send = vi.fn(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    let saved = "";
    const queue = new OrderObservationOutbox({ owner: () => "u1", capacity: 1, send, read: () => JSON.stringify([event("event-001"), event("event-002")]), write: (value) => { saved = value; } });
    await queue.flush();
    const rows = send.mock.calls[0]![1];
    expect(rows.filter((row: OrderObservationEvent) => row.kind !== "transport_gap")).toHaveLength(1);
    expect(rows.find((row: OrderObservationEvent) => row.kind === "transport_gap")?.reasonCode).toBe("outbox_restore_overflow");
    expect(JSON.parse(saved)).toEqual([]);
  });

  it("does not keep reporting storage failures after storage recovers", async () => {
    let fails = true;
    const send = vi.fn(async (_owner, rows) => rows.map((row: OrderObservationEvent) => row.eventId));
    const queue = new OrderObservationOutbox({ owner: () => "u1", send, read: () => null, write: () => {
      if (fails)
        throw new Error("quota");
    } });
    queue.enqueue(event("event-001"));
    await queue.flush();
    fails = false;
    await queue.flush();
    queue.enqueue({ ...event("event-002"), linkId: 456 });
    await queue.flush();
    expect(send.mock.calls.at(-1)![1].map((row: OrderObservationEvent) => row.kind)).toEqual(["submission_started"]);
  });
});
