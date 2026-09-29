import { afterEach, describe, expect, it, vi } from "vitest";
const saveUserLog = vi.hoisted(() => vi.fn(async (_message: string, _data?: unknown) => {}));
vi.mock("@changmen/client-core/bridge/clientApi", () => ({ saveUserLog }));
import { tracePolymarketOrder } from "./orderTrace";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("PM order timeline", () => {
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
