import type { GtcOrderPorts, PreparedGtcOrder } from "./orderService";
import { beforeEach, expect, it, vi } from "vitest";
import { submitPreparedGtcOrder } from "./orderService";

const plan = { tokenId: "token", conditionId: "condition", shares: "10", targetShares: "10", price: "0.5",
  maxPrincipal: "5", allInBudget: "5", protocol: 2 as const, negRisk: false, route: "direct", orderHash: "hash" };
let prepared: PreparedGtcOrder;
let ports: GtcOrderPorts;
let events: string[];
beforeEach(() => {
  events = [];
  prepared = { ...plan, validate: vi.fn(() => { events.push("validate"); }),
    prepareSubmit: vi.fn(async () => { events.push("prepare"); }),
    submit: vi.fn(async () => { events.push("POST"); return { success: true, orderID: "hash" }; }) };
  ports = {
    assertSession: vi.fn(), create: vi.fn(async () => { events.push("create"); return "id"; }),
    authorize: vi.fn(async () => { events.push("authorize"); }), acknowledge: vi.fn(async () => { events.push("ack"); }),
    recordUnknown: vi.fn(async () => { events.push("unknown"); }), close: vi.fn(async () => { events.push("close"); }),
    refresh: vi.fn(async () => { events.push("query"); }),
  };
});
it("persists and authorizes before sending, then closes only the send window and queries the original", async () => {
  expect(await submitPreparedGtcOrder(prepared, ports)).toBe("id");
  expect(events).toEqual(["validate", "create", "prepare", "authorize", "POST", "ack", "close", "query"]);
  expect(ports.create).toHaveBeenCalledWith(plan);
});
it("a pending storage authorization cannot reach the venue", async () => {
  let allow!: () => void;
  ports.authorize = vi.fn(() => new Promise<void>(resolve => { allow = resolve; }));
  const task = submitPreparedGtcOrder(prepared, ports);
  await vi.waitFor(() => expect(ports.authorize).toHaveBeenCalled());
  expect(prepared.submit).not.toHaveBeenCalled();
  allow(); await task;
  expect(prepared.submit).toHaveBeenCalledOnce();
});
it.each(["create", "authorize"] as const)("%s failure prevents POST without fallback", async operation => {
  vi.mocked(ports[operation]).mockRejectedValueOnce(new Error("storage offline"));
  await expect(submitPreparedGtcOrder(prepared, ports)).rejects.toThrow("storage offline");
  expect(prepared.submit).not.toHaveBeenCalled();
  expect(ports.close).toHaveBeenCalledTimes(operation === "create" ? 0 : 1);
});
it("failed signing validation never reserves or submits", async () => {
  vi.mocked(prepared.validate).mockImplementationOnce(() => { throw new Error("stale quote"); });
  await expect(submitPreparedGtcOrder(prepared, ports)).rejects.toThrow("stale quote");
  expect(ports.create).not.toHaveBeenCalled(); expect(prepared.submit).not.toHaveBeenCalled();
});
it("a session change after authorization still prevents POST and closes the window", async () => {
  vi.mocked(ports.assertSession).mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    .mockImplementationOnce(() => { throw new Error("session changed"); });
  await expect(submitPreparedGtcOrder(prepared, ports)).rejects.toThrow("session changed");
  expect(prepared.submit).not.toHaveBeenCalled(); expect(ports.close).toHaveBeenCalledOnce();
});
it("network timeout is unknown and only queries the same id; it never submits again", async () => {
  vi.mocked(prepared.submit).mockRejectedValueOnce(new Error("timeout"));
  await submitPreparedGtcOrder(prepared, ports);
  expect(prepared.submit).toHaveBeenCalledOnce(); expect(ports.recordUnknown).toHaveBeenCalledWith("id", "timeout");
  expect(ports.refresh).toHaveBeenCalledWith("id"); expect(ports.acknowledge).not.toHaveBeenCalled();
});
it("explicit unsent and rejected receipts stay distinct from unknown transport failures", async () => {
  const receipt = { success: false, pmSubmitNotSent: true, errorMsg: "clock changed" };
  vi.mocked(prepared.submit).mockResolvedValueOnce(receipt);
  await submitPreparedGtcOrder(prepared, ports);
  expect(ports.acknowledge).toHaveBeenCalledWith("id", receipt); expect(ports.recordUnknown).not.toHaveBeenCalled();
});
it("query failure after acceptance does not retry or lose the original id", async () => {
  vi.mocked(ports.refresh).mockRejectedValueOnce(new Error("offline"));
  expect(await submitPreparedGtcOrder(prepared, ports)).toBe("id"); expect(prepared.submit).toHaveBeenCalledOnce();
});
it("an observation failure cannot turn a recorded receipt into an unknown submission", async () => {
  ports.onReceipt = () => { throw new Error("log unavailable"); };
  expect(await submitPreparedGtcOrder(prepared, ports)).toBe("id");
  expect(ports.acknowledge).toHaveBeenCalledOnce(); expect(ports.recordUnknown).not.toHaveBeenCalled(); expect(prepared.submit).toHaveBeenCalledOnce();
});
