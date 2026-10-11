import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../pmClientApi", () => ({
  pmPostHeartbeat: vi.fn(),
}));

import { pmPostHeartbeat } from "../../pmClientApi";
import {
  ensurePolymarketHeartbeat,
  getPolymarketHeartbeatAccountIdsForTests,
  POLYMARKET_HEARTBEAT_INTERVAL_MS,
  stopAllPolymarketHeartbeats,
  stopPolymarketHeartbeat,
} from "../../pmHeartbeat";

describe("pmHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(pmPostHeartbeat).mockReset();
    vi.mocked(pmPostHeartbeat).mockResolvedValue({ heartbeat_id: "hb-1" });
    stopAllPolymarketHeartbeats();
  });

  afterEach(() => {
    stopAllPolymarketHeartbeats();
    vi.useRealTimers();
  });

  it("starts heartbeat once per account and posts Pm_Heartbeat", async () => {
    const account = {
      accountId: 42,
      gateway: "https://clob.polymarket.com",
      token: "{}",
    } as any;

    ensurePolymarketHeartbeat(account);
    ensurePolymarketHeartbeat(account);

    expect(getPolymarketHeartbeatAccountIdsForTests()).toEqual([42]);
    await Promise.resolve();
    await Promise.resolve();

    expect(pmPostHeartbeat).toHaveBeenCalledWith(account, "");
    const callsAfterStart = vi.mocked(pmPostHeartbeat).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLYMARKET_HEARTBEAT_INTERVAL_MS);
    expect(vi.mocked(pmPostHeartbeat).mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it("stop removes session", () => {
    ensurePolymarketHeartbeat({ accountId: 7, gateway: "https://clob.polymarket.com", token: "{}" } as any);
    stopPolymarketHeartbeat(7);
    expect(getPolymarketHeartbeatAccountIdsForTests()).toEqual([]);
  });
});
