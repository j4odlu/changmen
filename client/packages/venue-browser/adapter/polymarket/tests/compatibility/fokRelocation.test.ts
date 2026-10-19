import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as legacyBet from "../../bet";
import * as movedBet from "../../fok/bet";
import * as movedSettlement from "../../fok/orderSettlement";
import * as movedDepth from "../../fok/pmFokDepthBufferMode";
import * as movedJobs from "../../fok/settlementJob";
import * as legacySettlement from "../../orderSettlement";
import * as legacyDepth from "../../pmFokDepthBufferMode";
import * as legacyJobs from "../../settlementJob";

afterEach(() => {
  vi.restoreAllMocks();
  legacyDepth.resetPmFokDepthBufferPrefsForTests();
  legacyJobs.clearPolymarketSettlementJobs();
  vi.useRealTimers();
});

describe("fok relocation compatibility", () => {
  for (const [name, legacy, moved] of [
    ["bet", legacyBet, movedBet],
    ["orderSettlement", legacySettlement, movedSettlement],
    ["settlementJob", legacyJobs, movedJobs],
    ["pmFokDepthBufferMode", legacyDepth, movedDepth],
  ] as const) {
    it(`${name}: old and relocated entries export the same values`, () => {
      expect(Object.keys(moved).sort()).toEqual(Object.keys(legacy).sort());
      for (const [key, value] of Object.entries(legacy))
        expect(Reflect.get(moved, key)).toBe(value);
    });
  }

  it("keeps one depth preference state across old and relocated callers", () => {
    legacyDepth.setPmFokDepthBufferPrefs({ enabled: true, multiplier: 2 });
    expect(movedDepth.getPmFokDepthBufferPrefs()).toEqual({ enabled: true, multiplier: 2 });
    expect(movedDepth.pmFokDepthBufferNeedUsdc(10)).toBe(20);
    movedDepth.setPmFokDepthBufferPrefs({ enabled: false, multiplier: 1.5 });
    expect(legacyDepth.pmFokDepthReuseMultiplier()).toBe(1);
    expect(legacyDepth.pmFokDepthBufferNeedUsdc(10)).toBeNull();
  });

  it("keeps a single confirmation job when old and relocated callers share an order", async () => {
    vi.useFakeTimers();
    const account = { accountId: 17, provider: "Polymarket" } as PlatformAccount;
    const payload = { outcome: "matched" as const, row: { id: "same-original", status: "matched" } };
    const implementation = await import("@changmen/venue-browser/polymarket/fok/orderSettlement");
    const settle = vi.spyOn(implementation, "settlePolymarketDelayedOrder").mockResolvedValue(payload);
    legacyJobs.startPolymarketSettlementJob(account, "same-original", { submittedAt: 1000 });
    movedJobs.startPolymarketSettlementJob(account, "same-original", { submittedAt: 2000 });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(movedJobs.getPolymarketSettlementDelayCtx(account, "same-original")?.submittedAt).toBe(1000);
    expect(await movedJobs.awaitPolymarketSettlementJob(account, "same-original")).toBe(payload);
    expect(await legacyJobs.awaitPolymarketSettlementJob(account, "same-original")).toBe(payload);
    movedJobs.clearPolymarketSettlementJob(account, "same-original");
    expect(await legacyJobs.awaitPolymarketSettlementJob(account, "same-original")).toBeNull();
  });
});
