import type { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateVenueOrders = vi.hoisted(() => vi.fn(async () => []));
const refreshBalance = vi.hoisted(() => vi.fn(async () => undefined));
const checkBetting = vi.hoisted(() => vi.fn(async (opt: unknown) => {
  const o = opt as { data?: unknown };
  o.data = {};
  return o;
}));
const betting = vi.hoisted(() => vi.fn(async (): Promise<{
  success: boolean;
  orderId: string;
  pending?: boolean;
  tip?: { pmOptimisticSaved?: boolean };
}> => ({
  success: true,
  orderId: "0xabc",
  tip: { pmOptimisticSaved: true },
})));
const getAccount = vi.hoisted(() => vi.fn());
const refreshOrderListAfterBind = vi.hoisted(() => vi.fn());
const markSuccessfulBet = vi.hoisted(() => vi.fn());
const wait = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({
    getAccount,
    checkBetting,
    betting,
    updateVenueOrders,
    refreshBalance,
  }),
}));
vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ config: { betMoney: 10 } }),
}));
vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({}),
}));
vi.mock("@/stores/betting/arbOrderBind", () => ({
  refreshOrderListAfterBind,
}));
vi.mock("@/stores/betting/successMarkers", () => ({
  markSuccessfulBet,
}));
vi.mock("@/domain/betting/betFilters", () => ({
  accountPassesMainBetFilter: () => true,
}));
vi.mock("@/domain/betting/singleLegRate", () => ({
  isSingleLegRateAtOdds: () => false,
}));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));
vi.mock("element-plus", () => ({
  ElMessageBox: {
    prompt: vi.fn(async () => ({ value: "25" })),
    alert: vi.fn(async () => undefined),
  },
}));

import { ElMessageBox } from "element-plus";
import { resetMapBetMuteForTests, setFullMatchMuteGlobal } from "@/extensions/mapBetMute";
import { resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly";
import { runManualBet } from "@/stores/betting/manualBet";

describe("runManualBet post-success sync", () => {
  beforeEach(() => {
    updateVenueOrders.mockClear();
    refreshBalance.mockClear();
    refreshOrderListAfterBind.mockClear();
    markSuccessfulBet.mockClear();
    wait.mockClear();
    betting.mockClear();
    checkBetting.mockClear();
    getAccount.mockReset();
    getAccount.mockReturnValue({
      provider: "Polymarket",
      getBalance: () => 1000,
    });
    betting.mockResolvedValue({
      success: true,
      orderId: "0xabc",
      tip: { pmOptimisticSaved: true },
    });
    resetPrematchFullOnlyForTests();
    resetMapBetMuteForTests();
    vi.mocked(ElMessageBox.prompt).mockClear();
    vi.mocked(ElMessageBox.alert).mockClear();
  });

  it("PM matched + optimistic saved: refresh without waitForOrderId", async () => {
    const match = { title: "A vs B", bets: [], game: "Valorant" } as unknown as ViewMatch;
    const bet = {
      id: 1,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Map 1",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: "Polymarket",
      matchId: "m1",
      betId: "b1",
      getOdds: () => 1.8,
      getItemId: () => "i1",
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(wait).not.toHaveBeenCalled();
    expect(updateVenueOrders).toHaveBeenCalledOnce();
    expect(updateVenueOrders).toHaveBeenCalledWith(expect.anything());
    expect(refreshOrderListAfterBind).toHaveBeenCalledOnce();
    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(markSuccessfulBet).toHaveBeenCalledOnce();
  });

  it("PM pending: waits then updateVenueOrders without waitForOrderId", async () => {
    betting.mockResolvedValueOnce({
      success: true,
      orderId: "0xdelayed",
      pending: true,
    });
    const match = { title: "A vs B", bets: [], game: "CS" } as unknown as ViewMatch;
    const bet = {
      id: 1,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Map 1",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: "Polymarket",
      matchId: "m1",
      betId: "b1",
      getOdds: () => 1.8,
      getItemId: () => "i1",
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(wait).toHaveBeenCalledWith(400);
    expect(updateVenueOrders).toHaveBeenCalledWith(expect.anything());
  });

  it("PM matched without optimistic tip: falls back to waitForOrderId", async () => {
    betting.mockResolvedValueOnce({
      success: true,
      orderId: "0xfallback",
    });
    const match = { title: "A vs B", bets: [], game: "CS" } as unknown as ViewMatch;
    const bet = {
      id: 1,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Map 1",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: "Polymarket",
      matchId: "m1",
      betId: "b1",
      getOdds: () => 1.8,
      getItemId: () => "i1",
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(wait).toHaveBeenCalledWith(400);
    expect(updateVenueOrders).toHaveBeenCalledWith(
      expect.anything(),
      { waitForOrderId: "0xfallback" },
    );
  });

  it("[changmen 扩展] 赛前全场模式下地图不弹 prompt", async () => {
    setPrematchFullMode("liveRound");
    const match = {
      id: 1,
      title: "A vs B",
      bets: [],
      liveRound: 0,
      startAt: Date.now() + 86_400_000,
    } as unknown as ViewMatch;
    const bet = {
      id: 1,
      round: 1,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Map 1",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: "Polymarket",
      getOdds: () => 1.8,
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(ElMessageBox.prompt).not.toHaveBeenCalled();
    expect(ElMessageBox.alert).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("[changmen 扩展] 全场胜负总关不能绕过手动下注核心入口", async () => {
    setFullMatchMuteGlobal(true);
    const match = {
      id: 1,
      title: "A vs B",
      bets: [],
      liveRound: 0,
      startAt: Date.now() + 86_400_000,
    } as unknown as ViewMatch;
    const bet = {
      id: 1,
      round: 0,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Full Match",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: "Polymarket",
      getOdds: () => 1.8,
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(ElMessageBox.prompt).not.toHaveBeenCalled();
    expect(ElMessageBox.alert).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });
});
