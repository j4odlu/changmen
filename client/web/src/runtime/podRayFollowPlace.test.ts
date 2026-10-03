import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  reserve: vi.fn(), finalize: vi.fn(), check: vi.fn(), bet: vi.fn(), getOrders: vi.fn(), save: vi.fn(), list: vi.fn(), sportSave: vi.fn(),
  account: { accountId: 7, provider: "RAY", playerName: "ray-7", gateway: "https://ray.invalid", token: "test", currency: "CNY" },
  userId: "ray-test-user",
}));
vi.mock("@/api/podBetExecution", () => ({ reservePodBetExecution: mocks.reserve, finalizePodBetExecution: mocks.finalize }));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save, getOrderList: mocks.list }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mocks.getOrders }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: [mocks.account], findAccount: () => mocks.account,
  checkBetting: mocks.check, betting: mocks.bet }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.userId }) }));
vi.mock("@/stores/sportOddsStore", () => ({ useSportOddsStore: () => ({ saveMany: mocks.sportSave }) }));

import { placePodRayFollowBet, readRayFootballBindTasks, syncRayFootballOrders, pickPodRayAutoTicket,
  podRayFollowPlaceBlock, type PodRayFollowPlaceTicket } from "./podRayFollowPlace";
import { parsePodBetSettings } from "./podBetSettings";

function ticket(): PodRayFollowPlaceTicket {
  return { id: "ray-pod-1", rayMatchId: "123", stake: 50, auto: true, accountIds: [7], fixtureStatus: "matched", fixtureBasis: "confirmed",
    market: { status: "matched", venue: "RAY", locked: false, oid: "odd-1", betId: "group-1", quote: 2,
      marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    quote: { status: "ok", quote: 2, minObOdds: 1.9, maxObOdds: 2.2, evPercent: 5 } };
}
const cap = { todayProfit: 0, openStake: 0, maxDailyLoss: 0 };
const venueOrder = () => ({ provider: "RAY", orderId: "official-ray-1", createAt: Date.now(), match: "Arsenal vs Chelsea",
  bet: "final Total", item: "Over 2.5", odds: 2, betMoney: 50, reward: 100, money: 0, status: "none", game: "885709" });

describe("RAY football execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = "ray-test-user";
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => memory.get(k) || null, setItem: (k: string, v: string) => memory.set(k, v) });
    localStorage.setItem("changmen:podBetSettings", JSON.stringify({ enabled: true, autoPlace: true, rayStake: 50, rayFollowAccountIds: [7] }));
    mocks.check.mockImplementation(async (_account, option) => {
      option.data = { order: [] };
      option.response = { match_name: "Arsenal vs Chelsea", match_stage: "final", group_name: "Total", name: "Over 2.5" };
      return option;
    });
    mocks.getOrders.mockResolvedValue([]);
    mocks.reserve.mockResolvedValue({ acquired: true, leaseToken: "lease-ray" });
    mocks.finalize.mockResolvedValue(undefined);
    mocks.bet.mockResolvedValue({ success: true, response: { code: 200 } });
    mocks.save.mockResolvedValue(undefined);
    mocks.list.mockResolvedValue({ list: [] });
  });

  it("defaults to no RAY accounts or stake and retains explicit settings", () => {
    expect(parsePodBetSettings({})).toMatchObject({ rayStake: 0, rayFollowAccountIds: [], rayDailyOrderLimit: 0 });
    expect(parsePodBetSettings({ rayStake: 50, rayFollowAccountIds: [7, 7], followVenues: ["RAY"] }))
      .toMatchObject({ rayStake: 50, rayFollowAccountIds: [7], followVenues: ["RAY"] });
  });
  it("requires confirmed identity and live prices for automatic execution", () => {
    const t = ticket();
    expect(pickPodRayAutoTicket([{ ...t, fixtureBasis: "guess" }], [], [], cap)).toBeNull();
    expect(pickPodRayAutoTicket([{ ...t, market: { ...t.market, fromLive: false } }], [], [], cap)).toBeNull();
    expect(pickPodRayAutoTicket([t], [], [], cap)?.id).toBe(t.id);
    expect(podRayFollowPlaceBlock({ ...t, submitBefore: Date.now() - 1 })).toContain("过期");
  });
  it("blocks repeated alerts, opposite selections and the loss cap", () => {
    const t = ticket();
    expect(pickPodRayAutoTicket([t], [t.id], [], cap)).toBeNull();
    expect(pickPodRayAutoTicket([t], [], [{ obMid: "123", marketCode: "totals", boardSide: "under" }], cap)).toBeNull();
    expect(pickPodRayAutoTicket([t], [], [], { ...cap, maxDailyLoss: 50, openStake: 50 })).toBeNull();
  });
  it("never posts when another page owns the execution", async () => {
    mocks.reserve.mockResolvedValue({ acquired: false });
    expect((await placePodRayFollowBet(ticket())).ok).toBe(false);
    expect(mocks.bet).not.toHaveBeenCalled();
  });
  it("rejects a prechecked price above the EV ceiling", async () => {
    mocks.check.mockResolvedValue({ data: {}, odds: 2.3 });
    await placePodRayFollowBet(ticket());
    expect(mocks.bet).not.toHaveBeenCalled();
  });
  it("does not submit if the signal expires during precheck", async () => {
    const t = ticket();
    mocks.getOrders.mockImplementation(async () => { t.submitBefore = Date.now() - 1; return []; });
    await placePodRayFollowBet(t);
    expect(mocks.bet).not.toHaveBeenCalled();
    expect(readRayFootballBindTasks()).toHaveLength(0);
  });
  it("does not submit after the logged-in user changes", async () => {
    mocks.getOrders.mockImplementation(async () => { mocks.userId = "new-user"; return []; });
    await placePodRayFollowBet(ticket());
    expect(mocks.bet).not.toHaveBeenCalled();
  });
  it("requires durable recovery storage before submitting", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
    await placePodRayFollowBet(ticket());
    expect(mocks.bet).not.toHaveBeenCalled();
  });
  it("selects the RAY draw by its odd ID without entering the esports store", async () => {
    const t = ticket();
    t.market = { ...t.market, marketCode: "moneyline", boardSide: "draw", oid: "ray-draw-odd" };
    await placePodRayFollowBet(t);
    expect(mocks.check.mock.calls[0][1]).toMatchObject({ type: "RAY", matchId: "123", itemId: "ray-draw-odd" });
    mocks.check.mock.calls[0][1].updateOdds(1.95);
    expect(mocks.sportSave).toHaveBeenCalledWith("RAY", [{ id: "ray-draw-odd", odds: 1.95 }]);
  });
  it("honors turning auto off while the precheck is in flight", async () => {
    mocks.getOrders.mockImplementation(async () => {
      localStorage.setItem("changmen:podBetSettings", JSON.stringify({ autoPlace: false })); return [];
    });
    await placePodRayFollowBet(ticket());
    expect(mocks.bet).not.toHaveBeenCalled();
    expect(readRayFootballBindTasks()).toHaveLength(0);
  });
  it("saves the recovery task before POST and tags the uniquely matched official order", async () => {
    mocks.bet.mockImplementation(async () => {
      expect(readRayFootballBindTasks()).toHaveLength(1);
      mocks.getOrders.mockResolvedValue([venueOrder()]);
      return { success: true, response: { code: 200 } };
    });
    expect((await placePodRayFollowBet(ticket())).ok).toBe(true);
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: "accepted" }));
    expect(mocks.save).toHaveBeenCalledWith(mocks.account, [expect.objectContaining({ orderId: "official-ray-1",
      domain: "sports", sport: "football", podClientId: "ray-pod-1", podRayMatchId: "123" })]);
    expect(readRayFootballBindTasks()).toHaveLength(0);
  });
  it("keeps unknown submissions recoverable and prevents retry", async () => {
    mocks.bet.mockResolvedValue({ success: false, message: "network lost" });
    await placePodRayFollowBet(ticket());
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown" }));
    expect(readRayFootballBindTasks()).toHaveLength(1);
    await placePodRayFollowBet(ticket());
    expect(mocks.bet).toHaveBeenCalledTimes(1);
    mocks.getOrders.mockResolvedValue([venueOrder()]);
    await syncRayFootballOrders();
    expect(readRayFootballBindTasks()).toHaveLength(0);
  });
  it("does not bind ambiguous new orders", async () => {
    await placePodRayFollowBet(ticket());
    mocks.getOrders.mockResolvedValue([venueOrder(), { ...venueOrder(), orderId: "official-ray-2" }]);
    await syncRayFootballOrders();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(readRayFootballBindTasks()).toHaveLength(1);
  });
  it("does not bind an order that existed before the submission", async () => {
    mocks.getOrders.mockResolvedValue([venueOrder()]);
    await placePodRayFollowBet(ticket());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(readRayFootballBindTasks()).toHaveLength(1);
  });
  it("persists settlement updates with football metadata", async () => {
    mocks.list.mockResolvedValue({ list: [{ Type: "RAY", Domain: "sports", Sport: "football", PlayerID: 7,
      OrderID: "official-ray-1", PodClientId: "ray-pod-1", PodRayMatchId: "123", Source: "football-pod-auto" }] });
    mocks.getOrders.mockResolvedValue([{ ...venueOrder(), status: "reject" }]);
    await syncRayFootballOrders();
    expect(mocks.save).toHaveBeenCalledWith(mocks.account, [expect.objectContaining({ status: "reject", domain: "sports", podClientId: "ray-pod-1" })]);
  });
});
