import { describe, expect, it } from "vitest";
import {
  UNKNOWN_SPORTS_SECONDS_DELAY,
  POLYMARKET_POST_DELAY_GET_LAG_MS,
  buildPolymarketDelayedPollOpts,
  buildPolymarketWatchTimeoutMs,
  parsePolymarketClobMarketDelay,
} from "@changmen/venue-browser/polymarket/orders/confirmation/marketDelay";

describe("parsePolymarketClobMarketDelay", () => {
  it("reads official sd / itode from CLOB market row", () => {
    expect(parsePolymarketClobMarketDelay({ sd: 3, itode: true })).toEqual({
      secondsDelay: 3,
      takerOrderDelayEnabled: true,
      fromMarket: true,
    });
  });

  it("sd=0 is a known market delay (no sports window)", () => {
    expect(parsePolymarketClobMarketDelay({ sd: 0 })).toEqual({
      secondsDelay: 0,
      takerOrderDelayEnabled: false,
      fromMarket: true,
    });
  });

  it("missing sd is unknown — conservative 30s, not 1s", () => {
    expect(parsePolymarketClobMarketDelay({})).toEqual({
      secondsDelay: UNKNOWN_SPORTS_SECONDS_DELAY,
      takerOrderDelayEnabled: false,
      fromMarket: false,
    });
  });
});

describe("buildPolymarketDelayedPollOpts", () => {
  it("waits full sd window before first poll (sd=1)", () => {
    const opts = buildPolymarketDelayedPollOpts(1);
    expect(opts.initialDelayMs).toBe(1_000);
    expect(opts.intervalMs).toBe(1_000);
    expect(opts.maxAttempts).toBe(2);
  });

  it("scales initial delay with sd=3; GET lag does not grow with sd", () => {
    const opts = buildPolymarketDelayedPollOpts(3);
    expect(opts.initialDelayMs).toBe(3_000);
    expect(opts.maxAttempts).toBe(2);
  });

  it("unknown sd waits the conservative 30s window, not extra 8s polls", () => {
    const opts = buildPolymarketDelayedPollOpts(UNKNOWN_SPORTS_SECONDS_DELAY);
    expect(opts.initialDelayMs).toBe(30_000);
    expect(opts.maxAttempts).toBe(2);
  });
});

describe("buildPolymarketWatchTimeoutMs", () => {
  it("covers poll budget plus GET-lag buffer, not a 10s pad", () => {
    const poll = buildPolymarketDelayedPollOpts(1);
    const timeout = buildPolymarketWatchTimeoutMs(1);
    const pollBudget = poll.initialDelayMs + poll.intervalMs * poll.maxAttempts;
    expect(timeout).toBe(pollBudget + POLYMARKET_POST_DELAY_GET_LAG_MS);
    expect(timeout).toBe(5_000);
  });
});
