import { beforeEach, describe, expect, it, vi } from "vitest";
import { runArbBetRound } from "@/stores/betting/runArbBetRound";

import { createDefaultUserConfig } from "@/types/userConfig";

const config = createDefaultUserConfig();
const processLoseOrders = vi.fn(async () => {});
const matchStoreState = {
  matchs: [] as { id: number; bets: { id: number }[] }[],
};
const loseOrders = new Map<number, { pendingVenueOrderId?: string; pendingRegularReceipt?: { checkAt: number } }>();

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
    processLoseOrders.mockReset();
    runA8ArbRound.mockReset();
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

  it("补单关闭时仍收尾没有场馆 ID 的普通馆已受理回执", async () => {
    config.betting = false;
    config.makeUp = false;
    loseOrders.clear();
    loseOrders.set(1, { pendingRegularReceipt: { checkAt: 1000 } });
    await runArbBetRound({ setMessage: vi.fn(), processLoseOrders });
    expect(processLoseOrders).toHaveBeenCalledOnce();
    expect(runA8ArbRound).not.toHaveBeenCalled();
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

  it("consumes a queue created during arb only after the whole arb round finishes (A8)", async () => {
    config.betting = true;
    config.makeUp = true;
    loseOrders.clear();
    const events: string[] = [];
    let finishArb!: () => void;
    const arbFinished = new Promise<void>((resolve) => { finishArb = resolve; });
    runA8ArbRound.mockImplementationOnce(async () => {
      loseOrders.set(3, {});
      events.push("queue_created");
      await arbFinished;
      events.push("arb_finished");
    });
    processLoseOrders.mockImplementationOnce(async () => { events.push("makeup"); });

    const round = runArbBetRound({ setMessage: () => {}, processLoseOrders });
    expect(loseOrders.has(3)).toBe(true);
    expect(processLoseOrders).not.toHaveBeenCalled();
    finishArb();
    await round;

    expect(events).toEqual(["queue_created", "arb_finished", "makeup"]);
    expect(processLoseOrders).toHaveBeenCalledOnce();
  });

  it("reads makeUp enabled during arb at the tail of the same round (A8)", async () => {
    config.betting = true;
    config.makeUp = false;
    loseOrders.clear();
    runA8ArbRound.mockImplementationOnce(async () => {
      loseOrders.set(3, {});
      config.makeUp = true;
    });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).toHaveBeenCalledOnce();
  });

  it("does not consume ordinary makeup when makeUp is disabled during arb (A8)", async () => {
    config.betting = true;
    config.makeUp = true;
    runA8ArbRound.mockImplementationOnce(async () => { config.makeUp = false; });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).not.toHaveBeenCalled();
  });

  it("does not consume a queue removed during arb (A8)", async () => {
    config.betting = true;
    config.makeUp = true;
    runA8ArbRound.mockImplementationOnce(async () => { loseOrders.clear(); });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).not.toHaveBeenCalled();
  });

  it("observes a pending venue order created during arb even when makeUp is off", async () => {
    config.betting = true;
    config.makeUp = false;
    loseOrders.clear();
    runA8ArbRound.mockImplementationOnce(async () => {
      loseOrders.set(3, { pendingVenueOrderId: "0xdelayed" });
    });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(processLoseOrders).toHaveBeenCalledOnce();
  });

  it("consumes a queue created by deferred binding before the arb round", async () => {
    config.betting = false;
    config.makeUp = true;
    loseOrders.clear();
    peekPendingOrderBinds.mockReturnValue([{ linkId: 1 }]);
    processPendingOrderBinds.mockImplementationOnce(async () => {
      loseOrders.set(3, {});
      return { ok: 1, fail: 0, left: 0 };
    });

    await runArbBetRound({ setMessage: () => {}, processLoseOrders });

    expect(runA8ArbRound).not.toHaveBeenCalled();
    expect(processLoseOrders).toHaveBeenCalledOnce();
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
