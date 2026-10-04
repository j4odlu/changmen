import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  finalize: vi.fn(),
  checkBetting: vi.fn(),
  betting: vi.fn(),
  append: vi.fn(),
  account: { accountId: 9, playerName: "PM-9", provider: "Polymarket" },
}));

vi.mock("@/api/podBetExecution", () => ({
  reservePodBetExecution: mocks.reserve,
  finalizePodBetExecution: mocks.finalize,
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({
    accounts: [mocks.account],
    checkBetting: mocks.checkBetting,
    betting: mocks.betting,
  }),
}));
vi.mock("@/stores/footballOrderStore", () => ({
  useFootballOrderStore: () => ({ appendVenuePlaced: mocks.append }),
}));
vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ userId: "u1", isLoggedIn: true, fetchUserInfo: vi.fn() }),
}));
vi.mock("@/security/pmVault", () => ({
  ensurePmVaultForAccounts: vi.fn(),
  hasVault: vi.fn().mockResolvedValue(false),
  mergeVaultKeysIntoAccounts: vi.fn(),
  migrateTokenPrivateKeysToVault: vi.fn().mockResolvedValue(0),
  normalizePmVaultUserId: (v: unknown) => String(v || ""),
}));

import { placePodPmFollowBet, type PodPmFollowPlaceTicket } from "@/runtime/podPmFollowPlace";

function ticket(): PodPmFollowPlaceTicket {
  return {
    id: "pod-pm-1",
    auto: true,
    stake: 50,
    accountIds: [9],
    fixtureStatus: "matched",
    pmMatchId: "pm-match-1",
    market: {
      status: "matched",
      venue: "Polymarket",
      locked: false,
      oid: "token-1",
      betId: "condition-1",
      quote: 1.9,
      marketCode: "totals",
      boardSide: "over",
      boardLine: 2.5,
      fromLive: true,
    },
    quote: { status: "ok", quote: 1.9, minObOdds: 1.8, maxObOdds: 2.2, evPercent: 4 },
  };
}

describe("POD Polymarket auto execution reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkBetting.mockResolvedValue({ data: { prepared: true }, checkError: "" });
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-pm", state: "reserved", venueOrderId: "" });
    mocks.finalize.mockResolvedValue(undefined);
    mocks.append.mockResolvedValue(undefined);
  });

  it("does not submit when another page already owns the execution", async () => {
    mocks.reserve.mockResolvedValue({ acquired: false, leaseToken: "", state: "accepted", venueOrderId: "pm-order" });
    const result = await placePodPmFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(mocks.betting).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("records accepted before persisting the football order", async () => {
    mocks.betting.mockResolvedValue({ success: true, pending: false, orderId: "pm-order", message: "matched" });
    const result = await placePodPmFollowBet(ticket());
    expect(result.ok).toBe(true);
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      leaseToken: "lease-pm",
      state: "accepted",
      venueOrderId: "pm-order",
    }));
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(mocks.append.mock.invocationCallOrder[0]);
  });

  it("records a venue response as a definitive failure", async () => {
    mocks.betting.mockResolvedValue({
      success: false,
      message: "FOK 未成交",
      response: { success: false, status: "unmatched" },
      tip: { pmPosted: true },
    });
    await placePodPmFollowBet(ticket());
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("records a missing venue response as unknown and never persists an order", async () => {
    mocks.betting.mockResolvedValue({ success: false, message: "request timeout", response: undefined, tip: null });
    const result = await placePodPmFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("结果未知");
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      state: "unknown",
      message: "request timeout",
    }));
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
