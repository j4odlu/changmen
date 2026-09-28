import { beforeEach, describe, expect, it, vi } from "vitest";
import { runArbBetRound } from "@/stores/betting/runArbBetRound";

import { createDefaultUserConfig } from "@/types/userConfig";

const config = createDefaultUserConfig();
const processLoseOrders = vi.fn(async () => {});
const matchStoreState = {
  matchs: [] as { id: number; bets: { id: number }[] }[],
};
const loseOrders = new Map<number, { pendingVenueOrderId?: string }>();

const runA8ArbRound = vi.fn(async () => {});

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ config }),
}));

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => matchStoreState,
}));

vi.mock("@/stores/loseOrderStore", () => ({
  useLoseOrderStore: () => ({ orders: loseOrders }),
}));

vi.mock("@/stores/betting/a8/runA8ArbRound", () => ({
  runA8ArbRound: () => runA8ArbRound(),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({}),
}));

const accountsFundingReady = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/stores/account/accountPicker", () => ({
  accountsFundingReady: () => accountsFundingReady(),
}));

vi.mock("@/stores/betting/autoBet/executeArbBet", () => ({
  executeArbBet: vi.fn(async () => {}),
}));

const processPendingOrderBinds = vi.hoisted(() => vi.fn(async () => ({ ok: 0, fail: 0, left: 0 })));
const peekPendingOrderBinds = vi.hoisted(() => vi.fn(() => [] as { linkId: number }[]));

vi.mock("@/stores/betting/pendingOrderBind", () => ({
  peekPendingOrderBinds: () => peekPendingOrderBinds(),
  processPendingOrderBinds: () => processPendingOrderBinds(),
}));

describe("runArbBetRound lose-order gate", () => {
  beforeEach(() => {
    Object.assign(config, createDefaultUserConfig());
    loseOrders.clear();
    loseOrders.set(1, {});
    loseOrders.set(2, {});
    matchStoreState.matchs = [];
    accountsFundingReady.mockReturnValue(true);
    processLoseOrders.mockClear();
    runA8ArbRound.mockClear();
    processPendingOrderBinds.mockClear();
    peekPendingOrderBinds.mockReturnValue([]);
  });

  it("always drains deferred bind queue", async () => {
    config.betting = false;
    config.makeUp = false;
    peekPendingOrderBinds.mockReturnValue([{ linkId: 1 }]);
    await runArbBetRound({ setMessage: () => {}, processLoseOrders });
    expect(processPendingOrderBinds).toHaveBeenCalledOnce();
  });

  it("processes lose orders when makeUp on even if betting off (A8 jb)", async () => {
    config.makeUp = true;
    config.betting = false;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).toHaveBeenCalledOnce();
    expect(runA8ArbRound).not.toHaveBeenCalled();
  });

  it("skips lose orders when makeUp off", async () => {
    config.makeUp = false;
    config.betting = true;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).not.toHaveBeenCalled();
  });

  it("continues pending venue observation when makeUp is off", async () => {
    config.makeUp = false;
    config.betting = false;
    loseOrders.set(1, { pendingVenueOrderId: "0xdelayed" });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).toHaveBeenCalledOnce();
    expect(runA8ArbRound).not.toHaveBeenCalled();
  });

  it("runs runA8ArbRound when betting on", async () => {
    config.betting = true;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(runA8ArbRound).toHaveBeenCalledOnce();
  });

  it("skips arb but still processes lose orders when funding not ready (A8)", async () => {
    config.betting = true;
    config.makeUp = true;
    accountsFundingReady.mockReturnValue(false);

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(runA8ArbRound).not.toHaveBeenCalled();
    expect(processLoseOrders).toHaveBeenCalledOnce();
  });
});

describe("runArbBetRound betMoney (A8 rolls per bet in prepareArbAttempt)", () => {
  beforeEach(() => {
    Object.assign(config, createDefaultUserConfig());
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    runA8ArbRound.mockClear();
  });

  it("does not randomize when minMoney is 0 (A8 minMoney!==0 gate)", async () => {
    config.betMoney = 999;
    config.minMoney = 0;
    config.maxMoney = 100;
    config.betting = true;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(config.betMoney).toBe(999);
  });

  it("skips randomize when maxMoney is 0", async () => {
    config.betMoney = 999;
    config.minMoney = 0;
    config.maxMoney = 0;
    config.betting = true;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(config.betMoney).toBe(999);
  });

  it("does not randomize at round level", async () => {
    config.betting = true;
    config.betMoney = 999;
    config.minMoney = 10;
    config.maxMoney = 110;

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(config.betMoney).toBe(999);
  });
});
