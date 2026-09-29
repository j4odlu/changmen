import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import {
  awaitPolymarketSettlementJob,
  clearPolymarketSettlementJobs,
  getPolymarketSettlementDelayCtx,
  startPolymarketSettlementJob,
} from "./settlementJob";

vi.mock("./orderSettlement", () => ({
  settlePolymarketDelayedOrder: vi.fn(),
}));

function pmAccount(accountId = 7): PlatformAccount {
  return { provider: "Polymarket", accountId } as PlatformAccount;
}

describe("settlementJob", () => {
  beforeEach(() => {
    vi.mocked(settlePolymarketDelayedOrder).mockReset();
    clearPolymarketSettlementJobs();
  });

  afterEach(() => {
    clearPolymarketSettlementJobs();
  });

  it("start is idempotent for same accountId+orderId", async () => {
    vi.mocked(settlePolymarketDelayedOrder).mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(() => resolve({ outcome: "matched", row: { status: "MATCHED" } }), 20),
        ),
    );

    startPolymarketSettlementJob(pmAccount(), "0xabc");
    startPolymarketSettlementJob(pmAccount(), "0xabc");

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledTimes(1);
    const out = await awaitPolymarketSettlementJob(pmAccount(), "0xabc");
    expect(out?.outcome).toBe("matched");
  });

  it("await returns null when no job was started", async () => {
    expect(await awaitPolymarketSettlementJob(pmAccount(), "0xmissing")).toBeNull();
  });

  it("different accounts with same orderId get separate jobs", () => {
    startPolymarketSettlementJob(pmAccount(1), "0xshared");
    startPolymarketSettlementJob(pmAccount(2), "0xshared");

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledTimes(2);
  });

  it("forwards poll opts to settlePolymarketDelayedOrder", async () => {
    vi.mocked(settlePolymarketDelayedOrder).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED" },
    });
    const poll = { initialDelayMs: 100, intervalMs: 200, maxAttempts: 3 };
    startPolymarketSettlementJob(pmAccount(), "0xopts", { poll });
    await awaitPolymarketSettlementJob(pmAccount(), "0xopts");
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 7 }),
      "0xopts",
      expect.objectContaining({ poll }),
    );
  });

  it("remembers delay poll for job-missing fallback", async () => {
    vi.mocked(settlePolymarketDelayedOrder).mockResolvedValue({
      outcome: "matched",
      row: { status: "MATCHED" },
    });
    const poll = { initialDelayMs: 3_000, intervalMs: 1_000, maxAttempts: 8 };
    startPolymarketSettlementJob(pmAccount(), "0xctx", {
      poll,
      conditionId: "0xc",
    });
    expect(getPolymarketSettlementDelayCtx(pmAccount(), "0xctx")).toEqual({
      submittedAt: expect.any(Number),
      poll,
      conditionId: "0xc",
    });
    await awaitPolymarketSettlementJob(pmAccount(), "0xctx");
  });

  it("preserves timeout as pending instead of coercing to unfilled", async () => {
    vi.mocked(settlePolymarketDelayedOrder).mockResolvedValue({
      outcome: "timeout",
      row: { status: "delayed" },
    });

    startPolymarketSettlementJob(pmAccount(), "0xtimeout");
    const out = await awaitPolymarketSettlementJob(pmAccount(), "0xtimeout");

    expect(out).toEqual({ outcome: "timeout", row: { status: "delayed" } });
    expect(await awaitPolymarketSettlementJob(pmAccount(), "0xtimeout")).toBeNull();
  });
});
