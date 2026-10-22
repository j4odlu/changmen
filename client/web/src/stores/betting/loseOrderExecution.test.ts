import type { ViewMatch } from "@/models/match";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { LoseOrderExecutionDependencies } from "./loseOrderExecution";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import { PlatformAccount } from "@/models/platformAccount";
import { createDefaultUserConfig } from "@/types/userConfig";
import { runLoseOrderExecution } from "./loseOrderExecution";

const resume = vi.hoisted(() => vi.fn(() => "not-pending"));
vi.mock("./loseOrderPm", () => ({ schedulePendingVenueMakeUpResume: resume, processPmMakeUpLeg: vi.fn() }));
vi.mock("./loseOrderRegular", () => ({ processA8RegularVenueMakeUpLeg: vi.fn() }));
vi.mock("./successMarkers", () => ({ markSuccessfulBet: vi.fn(), readUsedAccounts: vi.fn(() => []) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => { throw new Error("global user store read"); } }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => { throw new Error("global match store read"); } }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => { throw new Error("global account store read"); } }));

function setup() {
  const order = new LoseOrder({
    matchId: 1, betId: 100, accountId: 1, target: "Home", betMoney: 100, betOdds: 1.85,
    linkId: 1000, isCreateOrder: false,
  });
  const orders = new Map([[100, order]]);
  const getAccount = vi.fn(() => undefined);
  const consumeOrder = vi.fn((current: LoseOrder) => { orders.delete(current.betId); });
  const deps: LoseOrderExecutionDependencies = {
    user: { config: createDefaultUserConfig(), extensionPrefs: {} } as LoseOrderExecutionDependencies["user"],
    matchStore: { matchs: [{ id: 1, bets: [{ id: 100, items: [{ type: "OB", getOdds: () => 4 }] }] } as unknown as ViewMatch] },
    accountStore: { getAccount } as unknown as LoseOrderExecutionDependencies["accountStore"],
    loseStore: { orders, consumeOrder } as unknown as LoseOrderExecutionDependencies["loseStore"],
    getMakeupSide: vi.fn(),
    passesMakeUpAccount: vi.fn(() => true),
    syncActiveBetMakeupAttempt: vi.fn(),
    scheduleArbFailAutoSellByLink: vi.fn(),
  };
  deps.user.config.makeUp = true;
  return { deps, order, orders, getAccount, consumeOrder };
}

function setupPrecheck() {
  const state = setup();
  const { deps, order } = state;
  order.betOdds = 2;
  deps.user.extensionPrefs.makeupOddsBand = {
    enabled: true, upper: 1.02, lower: 0.96, mode: "profitRate", upperProfitPct: 4, lowerLossPct: 3,
  };
  const item = { type: "OB", matchId: "m1", betId: "b1", getOdds: () => 2.4, getItemId: () => "OB:Home" };
  deps.matchStore = { matchs: [{ id: 1, bets: [{ id: 100, items: [item] }] } as unknown as ViewMatch] };
  const account = new PlatformAccount({ accountId: 1, provider: "OB", currency: "CNY" });
  const checkBetting = vi.fn(async (_account: PlatformAccount, option: BetOption): Promise<BetOption> => Object.assign(option, { data: {} }));
  const betting = vi.fn(async () => ({ success: false }));
  deps.accountStore = { getAccount: vi.fn(() => account), checkBetting, betting } as unknown as LoseOrderExecutionDependencies["accountStore"];
  return { ...state, account, checkBetting, betting };
}

describe("lose-order execution with explicit state", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("uses injected disabled configuration and still hands pending checks the supplied stores", async () => {
    const { deps, order, orders, getAccount } = setup();
    deps.user.config.makeUp = false;
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(resume).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      order, loseStore: deps.loseStore, accountStore: deps.accountStore,
    }));
    expect(orders.get(100)).toBe(order);
    expect(getAccount).not.toHaveBeenCalled();
    expect(deps.getMakeupSide).not.toHaveBeenCalled();
  });

  it("consumes the supplied queue when the supplied match list has no target", async () => {
    const { deps, order, orders, getAccount, consumeOrder } = setup();
    deps.matchStore = { matchs: [] };
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(consumeOrder).toHaveBeenCalledExactlyOnceWith(order);
    expect(orders.size).toBe(0);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("selects accounts through the supplied account store", async () => {
    const { deps, order, orders, getAccount } = setup();
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(getAccount).toHaveBeenCalledOnce();
    expect(orders.get(100)).toBe(order);
    expect(deps.getMakeupSide).not.toHaveBeenCalled();
  });

  it.each([
    { odds: 2, stake: 100, submits: false },
    { odds: 1.8, stake: 100, submits: true },
    { odds: 2.4, stake: 83, submits: true },
    { odds: 2.4, stake: 100, submits: false },
    { odds: 2.4, stake: 0, submits: false },
  ])("uses checked odds $odds and stake $stake before submission", async ({ odds, stake, submits }) => {
    const { deps, order, orders, account, checkBetting, betting } = setupPrecheck();
    checkBetting.mockImplementation(async (_account, option) => Object.assign(option, { data: {}, odds, betMoney: stake, newOdds: 9 }));
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(checkBetting).toHaveBeenCalledOnce();
    expect(betting).toHaveBeenCalledTimes(submits ? 1 : 0);
    expect(deps.getMakeupSide).toHaveBeenCalledTimes(submits ? 1 : 0);
    expect(deps.syncActiveBetMakeupAttempt).toHaveBeenCalledTimes(submits ? 1 : 0);
    if (submits) {
      const checked = await checkBetting.mock.results[0]!.value;
      expect(betting).toHaveBeenCalledWith(account, checked, 10, { linkId: order.linkId });
      expect(checked.betMoney).toBe(stake);
      expect(checked.odds).toBe(odds);
    }
    expect(orders.get(100)).toBe(order);
  });

  it("skips the gate when precheck has no data", async () => {
    const { deps, checkBetting, betting } = setupPrecheck();
    checkBetting.mockImplementation(async (_account, option) => {
      Object.defineProperty(option, "odds", { get: () => { throw new Error("gate read before successful precheck"); } });
      return option;
    });
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(betting).not.toHaveBeenCalled();
  });

  it("continues to the next candidate after a checked quote enters the band", async () => {
    const { deps, checkBetting, betting } = setupPrecheck();
    const items = deps.matchStore.matchs[0]!.bets[0]!.items;
    items.push({ ...items[0]!, getOdds: () => 2.3 });
    checkBetting.mockImplementation(async (_account, option) => Object.assign(option, {
      data: {}, odds: checkBetting.mock.calls.length === 1 ? 2 : 1.8, betMoney: 100,
    }));
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(betting).toHaveBeenCalledOnce();
    expect(betting).toHaveBeenCalledWith(expect.anything(), await checkBetting.mock.results[1]!.value, 10, { linkId: 1000 });
  });

  it("stops before reading the precheck result if the original queue entry was replaced", async () => {
    const { deps, orders, order, checkBetting, betting } = setupPrecheck();
    const replacement = new LoseOrder({ ...order });
    checkBetting.mockImplementation(async (_account, option) => {
      orders.set(100, replacement);
      Object.defineProperty(option, "data", { get: () => { throw new Error("result read after replacement"); } });
      return option;
    });
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(betting).not.toHaveBeenCalled();
    expect(orders.get(100)).toBe(replacement);
  });

  it("retains the existing manual queue bypass after a successful precheck", async () => {
    const { deps, order, checkBetting, betting } = setupPrecheck();
    order.isCreateOrder = true;
    checkBetting.mockImplementation(async (_account, option) => Object.assign(option, { data: {}, odds: 2, betMoney: 100 }));
    await runLoseOrderExecution({ setMessage: vi.fn() }, deps);
    expect(betting).toHaveBeenCalledOnce();
  });
});
