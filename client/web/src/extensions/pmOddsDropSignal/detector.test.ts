import { describe, expect, it } from "vitest";
import { PmOddsDropDetector } from "./detector";

describe("pmOddsDropDetector", () => {
  it("emits when decimal odds fall through the configured threshold", () => {
    const detector = new PmOddsDropDetector({ windowMs: 5_000, thresholdPct: 5, cooldownMs: 10_000 });
    expect(detector.push({ assetId: "home", bestAsk: 0.5, receivedAt: 1_000 })).toBeNull();

    const signal = detector.push({ assetId: "home", bestAsk: 0.53, receivedAt: 2_000 });
    expect(signal).not.toBeNull();
    expect(signal?.beforeOdds).toBe(2);
    expect(signal?.currentOdds).toBeCloseTo(1 / 0.53);
    expect(signal?.dropPct).toBeCloseTo(5.6603, 3);
  });

  it("uses the highest decimal odds inside the rolling window", () => {
    const detector = new PmOddsDropDetector({ windowMs: 3_000, thresholdPct: 5, cooldownMs: 0 });
    detector.push({ assetId: "away", bestAsk: 0.5, receivedAt: 1_000 });
    detector.push({ assetId: "away", bestAsk: 0.51, receivedAt: 2_000 });
    const signal = detector.push({ assetId: "away", bestAsk: 0.53, receivedAt: 3_000 });

    expect(signal?.beforeBestAsk).toBe(0.5);
    expect(signal?.windowMs).toBe(2_000);
  });

  it("does not compare against samples outside the window", () => {
    const detector = new PmOddsDropDetector({ windowMs: 1_000, thresholdPct: 5, cooldownMs: 0 });
    detector.push({ assetId: "token", bestAsk: 0.5, receivedAt: 1_000 });
    expect(detector.push({ assetId: "token", bestAsk: 0.54, receivedAt: 2_001 })).toBeNull();
  });

  it("applies cooldown independently per asset", () => {
    const detector = new PmOddsDropDetector({ windowMs: 5_000, thresholdPct: 1, cooldownMs: 10_000 });
    detector.push({ assetId: "a", bestAsk: 0.5, receivedAt: 1_000 });
    expect(detector.push({ assetId: "a", bestAsk: 0.51, receivedAt: 2_000 })).not.toBeNull();
    expect(detector.push({ assetId: "a", bestAsk: 0.52, receivedAt: 3_000 })).toBeNull();

    detector.push({ assetId: "b", bestAsk: 0.5, receivedAt: 2_000 });
    expect(detector.push({ assetId: "b", bestAsk: 0.51, receivedAt: 3_000 })).not.toBeNull();
  });

  it("keeps out-of-range samples as baselines without consuming cooldown", () => {
    const detector = new PmOddsDropDetector({ windowMs: 5_000, thresholdPct: 5, cooldownMs: 10_000 });
    const inRange = (odds: number) => odds >= 1.8 && odds <= 2;

    detector.push({ assetId: "range", bestAsk: 1 / 2.2, receivedAt: 1_000 }, inRange);
    expect(detector.push({ assetId: "range", bestAsk: 1 / 2.05, receivedAt: 2_000 }, inRange)).toBeNull();
    const signal = detector.push({ assetId: "range", bestAsk: 1 / 1.9, receivedAt: 3_000 }, inRange);

    expect(signal?.beforeOdds).toBeCloseTo(2.2);
    expect(signal?.currentOdds).toBeCloseTo(1.9);
  });
});
