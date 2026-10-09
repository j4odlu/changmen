import { afterEach, describe, expect, it, vi } from "vitest";
const saveUserLog = vi.hoisted(() => vi.fn(async (_message: string, _data?: unknown) => {}));
vi.mock("@changmen/client-core/bridge/clientApi", () => ({ saveUserLog }));
import { tracePolymarketOrder, tracePolymarketWsMessage, polymarketReadErrorDetails } from "./orderTrace";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("PM order timeline", () => {
  it("records an unrecognized correlated WS frame without its secret or error body", () => {
    tracePolymarketWsMessage(285, "original", { id: "original", event_type: "order", status: "rejected: details", reason: "private-text", secret: "must-not-leak", size_matched: "0" }, null, 100, false);
    const data = saveUserLog.mock.calls[0]?.[1];
    expect(data).toMatchObject({ eventType: "order", interpretation: "unrecognized", statusFormat: "non_enum", sizeMatched: 0, errorCategory: "other", messageFields: ["id", "event_type", "status", "reason", "size_matched"] });
    expect(data).not.toHaveProperty("status");
    expect(JSON.stringify(data)).not.toMatch(/must-not-leak|private-text|rejected: details/);
  });
  it("records FAILED and incomplete cancellation without treating them as whole-order rejection", () => {
    tracePolymarketWsMessage(285, "original", { event_type: "trade", status: "FAILED", taker_order_id: "original" }, null, 100, true);
    expect(saveUserLog.mock.calls[0]?.[1]).toMatchObject({ interpretation: "trade_failed", replayed: true });
    tracePolymarketWsMessage(285, "original", { event_type: "order", type: "CANCELLATION", id: "original" }, null, 101, false);
    expect(saveUserLog.mock.calls[1]?.[1]).toMatchObject({ interpretation: "missing_fill_quantity" });
  });
  it.each([[404, "not_found"], [401, "auth"], [429, "rate_limit"], [503, "http_error"]])("classifies read HTTP %s without logging the response", (status, errorCategory) => {
    expect(polymarketReadErrorDetails({ response: { status, data: "secret" } })).toEqual({ upstreamStatus: status, errorCategory });
  });
  it("separates local timeouts from official HTTP errors", () => {
    expect(polymarketReadErrorDetails(new Error("PM 查询超时"))).toEqual({ errorCategory: "query_timeout" });
  });
  it("records original order timing with an explicit field whitelist", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    tracePolymarketOrder(285, "original", "decision", {
      submittedAt: 8_000, startedAt: 9_000, outcome: "unfilled",
      token: "must-not-leak", response: { signature: "must-not-leak" },
    } as never);
    const data = saveUserLog.mock.calls[0]?.[1];
    expect(data).toMatchObject({ orderId: "original", accountId: 285, sinceSubmitMs: 2_000, durationMs: 1_000, outcome: "unfilled" });
    expect(JSON.stringify(data)).not.toContain("must-not-leak");
  });
  it("does not propagate log transport failure into confirmation", async () => {
    saveUserLog.mockRejectedValueOnce(new Error("offline"));
    expect(() => tracePolymarketOrder(285, "original", "watch")).not.toThrow();
    await Promise.resolve();
  });
});
