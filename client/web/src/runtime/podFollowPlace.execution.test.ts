import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  finalize: vi.fn(),
  place: vi.fn(),
  append: vi.fn(),
  accounts: [{ accountId: 7, playerName: "OB-7", provider: "OB" }],
}));

vi.mock("@/api/podBetExecution", () => ({
  reservePodBetExecution: mocks.reserve,
  finalizePodBetExecution: mocks.finalize,
}));
vi.mock("@/runtime/obSportBetAccount", () => ({ pickObSportBetAccounts: () => mocks.accounts }));
vi.mock("@/runtime/obSportPlaceBet", () => ({ placeObSportSingle: mocks.place }));
vi.mock("@/runtime/podBetSettings", () => ({
  readPodBetSettings: () => ({ followAccountIds: [7], obAccountRotation: "all" }),
}));
vi.mock("@/runtime/podObAccountRotation", () => ({ pickPodObAccountsForPlacement: () => mocks.accounts }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mocks.accounts }) }));
vi.mock("@/stores/footballOrderStore", () => ({
  useFootballOrderStore: () => ({ appendPlaced: mocks.append }),
}));

import { placePodFollowBet, type PodFollowPlaceTicket } from "@/runtime/podFollowPlace";

function ticket(): PodFollowPlaceTicket {
  return {
    id: "pod-alert-1",
    auto: true,
    stake: 50,
    accountIds: [7],
    fixtureStatus: "matched",
    obMid: "mid-1",
    market: {
      status: "matched",
      ob: true,
      locked: false,
      oid: "oid-1",
      quote: 1.95,
      marketCode: "totals",
      boardSide: "over",
      boardLine: 2.5,
      fromLive: true,
    },
    quote: { status: "ok", quote: 1.95, minObOdds: 1.9, maxObOdds: 2.2, evPercent: 5 },
  };
}

describe("POD auto execution lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finalize.mockResolvedValue(undefined);
    mocks.append.mockResolvedValue(undefined);
  });

  it("never calls the venue when another page owns the alert/account", async () => {
    mocks.reserve.mockResolvedValue({ acquired: false, leaseToken: "", state: "accepted", venueOrderId: "v1" });
    const result = await placePodFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("records accepted before persisting the local football order", async () => {
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-1", state: "reserved", venueOrderId: "" });
    mocks.place.mockResolvedValue({ ok: true, message: "ok", orderId: "venue-9", odds: 1.96 });
    const result = await placePodFollowBet(ticket());
    expect(result.ok).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ outcomeScope: "mid-1|FT|Total" }));
    expect(mocks.place).toHaveBeenCalledWith(expect.objectContaining({ minOdds: 1.9, maxOdds: 2.2 }));
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      leaseToken: "lease-1",
      state: "accepted",
      venueOrderId: "venue-9",
    }));
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(mocks.append.mock.invocationCallOrder[0]);
  });

  it("closes the lease as failed when the venue rejects", async () => {
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-2", state: "reserved", venueOrderId: "" });
    mocks.place.mockResolvedValue({ ok: false, message: "锁盘" });
    const result = await placePodFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", message: "锁盘" }));
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("marks transport exceptions unknown and never retries locally", async () => {
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-3", state: "reserved", venueOrderId: "" });
    mocks.place.mockRejectedValue(new Error("timeout"));
    const result = await placePodFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown", message: "timeout" }));
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("keeps a submit-phase ambiguous response in unknown state", async () => {
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-4", state: "reserved", venueOrderId: "" });
    mocks.place.mockResolvedValue({ ok: false, message: "network disconnected", outcomeUnknown: true });
    const result = await placePodFollowBet(ticket());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("结果未知");
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      state: "unknown",
      message: "network disconnected",
    }));
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
