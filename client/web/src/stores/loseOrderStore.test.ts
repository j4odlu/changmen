import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";

import { useLoseOrderStore } from "@/stores/loseOrderStore";

const publishLoseOrderMessage = vi.fn();

vi.mock("@/stores/messageStore", () => ({
  useMessageStore: () => ({
    publishLoseOrderMessage,
  }),
}));

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({
    matchs: [
      {
        id: 1,
        title: "A vs B",
        bets: [{ id: 2, getBetName: () => "map1" }],
      },
    ],
  }),
}));

vi.mock("@/extensions/arbBet/arbFailAutoSell", () => ({
  maybeArbFailAutoSellByLink: vi.fn(async () => false),
}));

describe("useLoseOrderStore A8 publish parity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    publishLoseOrderMessage.mockClear();
    vi.stubGlobal(
      "sessionStorage",
      {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    );
  });

  it("persists the original pending snapshot across retries and restoration", () => {
    const store = useLoseOrderStore();
    store.createOrder(new LoseOrder({ betId: 55, createAt: 1000 }));
    store.setPendingVenueOrder(55, "original", 7, { submittedAt: 900, odds: 2.2, betMoney: 38.22 });
    store.orders.get(55)!.pendingVenueError = "核验异常";
    store.setPendingVenueOrder(55, "original", 7, { submittedAt: 9999, odds: 1.1, betMoney: 80 });
    const restored = new LoseOrder(store.orders.get(55)!.toJSON());
    expect(restored).toMatchObject({ pendingVenueSubmittedAt: 900, pendingVenueOdds: 2.2,
      pendingVenueBetMoney: 38.22, pendingVenueError: "核验异常" });
    store.clearPendingVenueOrder(55);
    expect(store.orders.get(55)!.pendingVenueError).toBeUndefined();
    expect(store.orders.get(55)!.toJSON()).not.toHaveProperty("pendingVenueSubmittedAt");
  });

  it("allows PM confirmation retries without the 30 second backoff", () => {
    const store = useLoseOrderStore();
    store.createOrder(new LoseOrder({ betId: 55, createAt: 1000 }));
    store.setPendingVenueOrder(55, "original", 7);
    for (let i = 0; i < 8; i++)
      store.deferPendingVenueOrder(55, 1_000);
    expect(store.orders.get(55)!.pendingVenueNextPollAt! - Date.now()).toBeLessThanOrEqual(1_000);
    store.deferPendingVenueOrder(55);
    expect(store.orders.get(55)!.pendingVenueNextPollAt! - Date.now()).toBeGreaterThan(29_000);
  });

  it("binds original USDC evidence to the exact order and account across session restore", () => {
    const store = useLoseOrderStore();
    store.createOrder(new LoseOrder({ betId: 55 }));
    const snapshot = pmSubmissionFromResult({ orderId: "original", beginTime: 1000,
      request: { order: { side: "BUY", makerAmount: "14930000" } } }, 317)!;
    store.setPendingVenueOrder(55, "original", 317, { pmSubmission: snapshot });
    store.setPendingVenueOrder(55, "original", 317, { pmSubmission: { ...snapshot, makerAmount: "118000000", stakeUsdc: 118 } });
    const restored = new LoseOrder(store.orders.get(55)!.toJSON());
    expect(restored.pendingPmSubmission).toEqual(snapshot);
    expect(new LoseOrder({ ...restored.toJSON(), pendingVenueAccountId: 318 }).pendingPmSubmission).toBeUndefined();
    store.setPendingVenueOrder(55, "another", 317, { pmSubmission: snapshot });
    expect(store.orders.get(55)!.pendingPmSubmission).toBeUndefined();
  });

  it("restores orders from sessionStorage on store create (A8 IIFE)", () => {
    const stored = JSON.stringify([
      {
        accountId: 0,
        matchId: 1,
        betId: 99,
        target: "Home",
        betMoney: 50,
        betOdds: 1.8,
        match: "A vs B",
        bet: "map1",
        linkId: 0,
        createAt: 1,
        isCreateOrder: false,
        betCount: 1,
      },
    ]);
    vi.stubGlobal(
      "sessionStorage",
      {
        getItem: vi.fn(() => stored),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    );
    setActivePinia(createPinia());
    const store = useLoseOrderStore();
    expect(store.orders.size).toBe(1);
    expect(store.orders.get(99)?.betMoney).toBe(50);
  });

  it("publishes only for manual isCreateOrder create", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 2,
        target: "Home",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 0,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      }),
    );
    expect(publishLoseOrderMessage).toHaveBeenCalledOnce();

    publishLoseOrderMessage.mockClear();
    store.createOrder(
      new LoseOrder({
        accountId: 1,
        matchId: 1,
        betId: 3,
        target: "Away",
        betMoney: 100,
        betOdds: 2.1,
        match: "A vs B",
        bet: "map1",
        linkId: 123,
        createAt: Date.now(),
        isCreateOrder: false,
        betCount: 1,
      }),
    );
    expect(publishLoseOrderMessage).not.toHaveBeenCalled();
  });

  it("does not publish on remove", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 2,
        target: "Home",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 0,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      }),
    );
    publishLoseOrderMessage.mockClear();
    store.removeOrder(2, true);
    expect(publishLoseOrderMessage).not.toHaveBeenCalled();
  });

  it("cancelMakeupManually removes queue item without keeping cancelled placeholder", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 1,
        matchId: 1,
        betId: 42,
        target: "Away",
        betMoney: 100,
        betOdds: 2.1,
        match: "A vs B",
        bet: "map1",
        linkId: 999,
        createAt: Date.now(),
        isCreateOrder: false,
        betCount: 1,
      }),
    );
    store.cancelMakeupManually(42);
    expect(store.orders.has(42)).toBe(false);
    expect(store.cancelledOrders.has(42)).toBe(false);
  });

  it("removeOrders prunes arb-linked makeup when bet left match list (A8)", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 1,
        matchId: 1,
        betId: 42,
        target: "Away",
        betMoney: 100,
        betOdds: 2.1,
        match: "A vs B",
        bet: "map1",
        linkId: 999,
        createAt: Date.now(),
        isCreateOrder: false,
        betCount: 1,
      }),
    );
    store.removeOrders([11, 12]);
    expect(store.orders.has(42)).toBe(false);
  });

  it("removeOrders prunes unlinked manual create orders when bet left match list (A8)", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 7,
        target: "Home",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 0,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      }),
    );
    store.removeOrders([11]);
    expect(store.orders.has(7)).toBe(false);
  });

  it("removeOrders prunes link-bound manual makeup when bet left match list (A8)", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 8,
        target: "Home",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 888,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      }),
    );
    store.removeOrders([11]);
    expect(store.orders.has(8)).toBe(false);
  });

  it("manualOrders getter returns only linkId=0 items", () => {
    const store = useLoseOrderStore();
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 21,
        target: "Home",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 0,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      }),
    );
    store.createOrder(
      new LoseOrder({
        accountId: 0,
        matchId: 1,
        betId: 22,
        target: "Away",
        betMoney: 100,
        betOdds: 1.9,
        match: "A vs B",
        bet: "map1",
        linkId: 888,
        createAt: Date.now(),
        isCreateOrder: false,
        betCount: 1,
      }),
    );
    expect(store.manualOrders).toHaveLength(1);
    expect(store.manualOrders[0]?.betId).toBe(21);
    expect(store.linkBoundCount).toBe(1);
  });
});
