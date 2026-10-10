import type { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { resolveVenueStakeFromPlanCny } from "@changmen/venue-adapter/adaptation";
import { clearPmTickBufferMetadata, clearPmTickStateForTests, notePmTickBufferBook, resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs } from "@changmen/venue-adapter/polymarket";
import { ElMessageBox } from "element-plus";
import { createPinia, setActivePinia } from "pinia";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { resetMapBetMuteForTests, setFullMatchMuteGlobal } from "@/extensions/mapBetMute";
import { resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly";
import { runManualBet } from "@/stores/betting/manualBet";
import { useOddsStore } from "@/stores/oddsStore";

const updateVenueOrders = vi.hoisted(() => vi.fn(async () => []));
const refreshBalance = vi.hoisted(() => vi.fn(async () => undefined));
const checkBetting = vi.hoisted(() => vi.fn(async (_account: unknown, opt: unknown, _opts?: { skipAccountRate?: boolean }) => {
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
const prompt = vi.hoisted(() => vi.fn(async (_message?: unknown, _title?: string, _options?: unknown) => ({ value: "25" })));
const executeManualGtc = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/orderModes/gtc/manual", () => ({ executeManualGtc }));

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
vi.mock("@/orderModes/gtc/accountFilter", () => ({ gtcAccountAllows: () => true }));
vi.mock("@/domain/betting/betFilters", () => ({
  accountPassesMainBetFilter: () => true,
}));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));
vi.mock("element-plus", () => ({
  ElMessageBox: {
    prompt,
    alert: vi.fn(async () => undefined),
  },
}));

describe("runManualBet post-success sync", () => {
  beforeEach(() => {
    executeManualGtc.mockReset();
    executeManualGtc.mockResolvedValue({ message: "GTC 下单成功", pm: { submission: "accepted" } } as never);
    setActivePinia(createPinia());
    clearPmTickStateForTests(); clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests();
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

  it("pM matched + optimistic saved: refresh without waitForOrderId", async () => {
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

  it.each(["percent", "tick"] as const)("%s quote is frozen before the amount prompt despite later asks and settings", async (mode) => {
    setPmArbPriceBufferPrefs({ enabled: true, mode, multiplier: 1.01 });
    const oddsStore = useOddsStore();
    oddsStore.save("Polymarket", { id: "i1", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
    notePmTickBufferBook("i1", { asset_id: "i1", tick_size: "0.01" });
    const initialOdds = oddsStore.getOdds("Polymarket", "i1");
    prompt.mockImplementationOnce(async () => {
      oddsStore.save("Polymarket", { id: "i1", odds: 1 / 0.49, clobPrice: 0.49, isLock: false, time: Date.now() });
      setPmArbPriceBufferPrefs({ enabled: false, multiplier: 1.02 });
      return { value: "25" };
    });
    checkBetting.mockImplementationOnce(async (_account, opt) => {
      attachPolymarketDetectionQuote(opt as import("@changmen/client-core/models/betOption").BetOption);
      return opt as any;
    });
    const match = { title: "A vs B", game: "Valorant" } as unknown as ViewMatch;
    const bet = { id: 1, homeName: "A", awayName: "B", getBetName: () => "Map 1" } as unknown as ViewBet;
    const item = { type: "Polymarket", matchId: "m1", betId: "b1", getOdds: () => oddsStore.getOdds("Polymarket", "i1"), getItemId: () => "i1" } as unknown as ViewBetItem;
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    expect(ElMessageBox.alert).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ odds: initialOdds, betMoney: 25, data: expect.objectContaining({ pmPriceQuote: expect.objectContaining({ mode, rawAsk: 0.5 }), detectionMaxPrice: mode === "tick" ? 0.51 : 0.505 }) }), expect.any(Number));
    resetPmArbPriceBufferPrefsForTests();
  });

  it.each(["Polymarket", "PredictFun"] as const)("%s 比例 9999 手动下单只换算币种，不放大金额", async (provider) => {
    const account = new PlatformAccount({
      accountId: 1,
      playerName: "manual",
      provider,
      currency: "USDT",
      balance: 1000,
      rateConfig: [{ minOdds: 1.5, maxOdds: 2, rate: 9999 }],
    });
    getAccount.mockReturnValue(account);
    prompt.mockResolvedValueOnce({ value: "90" });
    // 使用预检边界的真实换算，避免只检查 mock 收到的原始金额而漏掉比例放大。
    checkBetting.mockImplementationOnce(async (_account, opt, opts) => {
      const option = opt as { betMoney: number; odds: number; data?: unknown };
      option.betMoney = resolveVenueStakeFromPlanCny(account, option.betMoney, option.odds, opts);
      option.data = {};
      return option;
    });
    const match = { title: "A vs B", bets: [], game: "Valorant" } as unknown as ViewMatch;
    const bet = {
      id: 1,
      homeName: "A",
      awayName: "B",
      getBetName: () => "Map 1",
      items: [],
    } as unknown as ViewBet;
    const item = {
      type: provider,
      matchId: "m1",
      betId: "b1",
      getOdds: () => 1.8,
      getItemId: () => "i1",
    } as unknown as ViewBetItem;

    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });

    expect(ElMessageBox.alert).not.toHaveBeenCalled();
    expect(checkBetting).toHaveBeenCalledWith(account, expect.objectContaining({ betMoney: 13.43 }), { skipAccountRate: true });
    expect(betting).toHaveBeenCalledWith(account, expect.objectContaining({ betMoney: 13.43 }), expect.any(Number));
  });

  it("pM pending: waits then updateVenueOrders without waitForOrderId", async () => {
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

  it("pM matched without optimistic tip: falls back to waitForOrderId", async () => {
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

describe("pM manual mode selection", () => {
  const match = { id: 1, title: "A vs B", bets: [], game: "CS" } as unknown as ViewMatch;
  const bet = { id: 1, homeName: "A", awayName: "B", getBetName: () => "Full Match", items: [] } as unknown as ViewBet;
  const item = { type: "Polymarket", matchId: "m1", betId: "b1", getOdds: () => 1.8, getItemId: () => "i1" } as unknown as ViewBetItem;
  beforeEach(() => {
    vi.clearAllMocks(); setActivePinia(createPinia()); resetMapBetMuteForTests(); resetPrematchFullOnlyForTests();
    getAccount.mockReturnValue({ provider: "Polymarket", getBalance: () => 1000 });
    prompt.mockResolvedValue({ value: "25" });
  });
  it("explicit GTC invokes the separate manual module and never old check/place/settlement", async () => {
    prompt.mockImplementationOnce(async (...args: unknown[]) => {
      const vnode = args[0] as { props: { "onUpdate:modelValue": (value: string) => void } };
      vnode.props["onUpdate:modelValue"]("GTC"); return { value: "25" };
    });
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    expect(executeManualGtc).toHaveBeenCalledOnce(); expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled(); expect(updateVenueOrders).not.toHaveBeenCalled();
  });
  it("opening another prompt resets to FOK after a GTC selection", async () => {
    prompt.mockImplementationOnce(async (...args: unknown[]) => {
      (args[0] as { props: { "onUpdate:modelValue": (value: string) => void } }).props["onUpdate:modelValue"]("GTC");
      return { value: "25" };
    });
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    expect(executeManualGtc).toHaveBeenCalledTimes(1); expect(betting).toHaveBeenCalledTimes(1);
    expect(checkBetting).toHaveBeenCalledWith(expect.anything(), expect.anything(), { skipAccountRate: true });
  });
  it("cancel after selecting GTC sends nothing", async () => {
    prompt.mockImplementationOnce(async (...args: unknown[]) => {
      (args[0] as { props: { "onUpdate:modelValue": (value: string) => void } }).props["onUpdate:modelValue"]("GTC");
      throw new Error("cancel");
    });
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    expect(executeManualGtc).not.toHaveBeenCalled(); expect(betting).not.toHaveBeenCalled(); expect(checkBetting).not.toHaveBeenCalled();
  });
  it("gTC failure cannot fall back to FOK", async () => {
    prompt.mockImplementationOnce(async (...args: unknown[]) => {
      (args[0] as { props: { "onUpdate:modelValue": (value: string) => void } }).props["onUpdate:modelValue"]("GTC");
      return { value: "25" };
    });
    executeManualGtc.mockRejectedValueOnce(new Error("GTC unavailable"));
    await runManualBet(match, bet, item, "Home", { setMessage: vi.fn() });
    expect(betting).not.toHaveBeenCalled(); expect(ElMessageBox.alert).toHaveBeenCalledWith("GTC unavailable", "PM GTC 手动下单");
  });
  it("other venues retain the plain amount prompt", async () => {
    getAccount.mockReturnValue({ provider: "RAY", getBalance: () => 1000 });
    await runManualBet(match, bet, { ...item, type: "RAY" } as ViewBetItem, "Home", { setMessage: vi.fn() });
    expect(prompt.mock.calls[0]?.[0]).toEqual(expect.any(String)); expect(executeManualGtc).not.toHaveBeenCalled();
  });
});
