import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  finalize: vi.fn(),
  fetchPlayers: vi.fn(),
}));

vi.mock("@changmen/db", () => ({
  reservePodBetExecution: mocks.reserve,
  finalizePodBetExecution: mocks.finalize,
  fetchPlayersByIds: mocks.fetchPlayers,
}));

import { finalizePodBet, reservePodBet } from "./football_order_service.js";

const user = { id: "11111111-1111-4111-8111-111111111111" };

function ownedPlayer(provider = "OB", ownerUserId = user.id) {
  return [{ id: 7, ownerUserId, provider, platformName: provider, playerName: `${provider}-7` }];
}

describe("POD bet execution service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPlayers.mockResolvedValue(ownedPlayer());
    mocks.reserve.mockResolvedValue({
      acquired: true,
      row: { state: "reserved", venue_order_id: "" },
    });
    mocks.finalize.mockResolvedValue({ state: "accepted" });
  });

  it("reserves only an account owned by the logged-in user", async () => {
    const result = await reservePodBet({ alertId: "pod-1", venue: "OB", playerId: 7 }, user);
    expect(result.ok).toBe(true);
    expect(result.info.acquired).toBe(true);
    expect(result.info.leaseToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      alertId: "pod-1",
      venue: "OB",
      playerId: 7,
    }));
  });

  it("fails closed before reservation when the account belongs to another user", async () => {
    mocks.fetchPlayers.mockResolvedValue(ownedPlayer("OB", "22222222-2222-4222-8222-222222222222"));
    const result = await reservePodBet({ alertId: "pod-1", venue: "OB", playerId: 7 }, user);
    expect(result).toMatchObject({ ok: false });
    expect(result.msg).toContain("不属于当前用户");
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("rejects a venue/account mismatch", async () => {
    mocks.fetchPlayers.mockResolvedValue(ownedPlayer("Polymarket"));
    const result = await reservePodBet({ alertId: "pod-1", venue: "OB", playerId: 7 }, user);
    expect(result).toMatchObject({ ok: false });
    expect(result.msg).toContain("不是 OB 账号");
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("reserves RAY only for an owned RAY account", async () => {
    mocks.fetchPlayers.mockResolvedValue(ownedPlayer("RAY"));
    const result = await reservePodBet({ alertId: "pod-ray-1", venue: "RAY", playerId: 7 }, user);
    expect(result.ok).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ venue: "RAY", playerId: 7 }));
  });

  it("returns an existing terminal state without issuing a new token", async () => {
    mocks.reserve.mockResolvedValue({
      acquired: false,
      row: { state: "unknown", venue_order_id: "" },
    });
    const result = await reservePodBet({ alertId: "pod-1", venue: "OB", playerId: 7 }, user);
    expect(result.info).toEqual({ acquired: false, leaseToken: "", state: "unknown", venueOrderId: "" });
  });

  it("finalizes only accepted, failed or unknown states", async () => {
    const bad = await finalizePodBet({ leaseToken: "lease", state: "reserved" }, user);
    expect(bad).toMatchObject({ ok: false });
    expect(mocks.finalize).not.toHaveBeenCalled();

    const good = await finalizePodBet({ leaseToken: "lease", state: "unknown", message: "timeout" }, user);
    expect(good).toEqual({ ok: true, info: { state: "accepted" } });
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      leaseToken: "lease",
      state: "unknown",
      message: "timeout",
    }));
  });
});
