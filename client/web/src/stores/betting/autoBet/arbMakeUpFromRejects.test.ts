import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { applyArbMakeUpFromRejects } from "@/stores/betting/autoBet/arbMakeUpFromRejects";

const enqueueMakeUpOrder = vi.hoisted(() => vi.fn());
const setPendingVenueOrder = vi.hoisted(() => vi.fn());
const createOrder = vi.hoisted(() => vi.fn());
const useLoseOrderStore = vi.hoisted(() =>
  vi.fn(() => ({
    orders: new Map(),
    setPendingVenueOrder,
    createOrder,
  })),
);

vi.mock("@/stores/betting/autoBet/makeUp", () => ({
  enqueueMakeUpOrder,
}));

vi.mock("@/stores/loseOrderStore", () => ({
  useLoseOrderStore,
}));

import { createDefaultUserConfig } from "@/types/userConfig";

function params(): ArbBetAttemptParams {
  return {
    match: { id: 1, title: "A vs B" } as never,
    bet: { id: 100, getBetName: () => "地图1" } as never,
    config: { ...createDefaultUserConfig(), makeUp: true } as never,
    setMessage: vi.fn(),
  };
}

function basePlaced(): ArbBetPlaced {
  const legA = new BetOption("RAY" as never, "m1", "b1", "h1", 40, "Home", 1.36);
  const legB = new BetOption("OB" as never, "m2", "b2", "a1", 70, "Away", 4.095);
  return {
    legA,
    legB,
    accountA: { accountId: 14 } as never,
    accountB: { accountId: 23 } as never,
    betBothLegs: true,
    linkId: 1782972494104,
    implied: 1.05,
    singleLegByRate: false,
    stakeScale: 1,
    waitSec: 10,
    scanOddsA: Number(legA.odds) || 0,
    scanOddsB: Number(legB.odds) || 0,
    resultA: new BetResult("RAY", false),
    resultB: new BetResult("OB", true),
    placeOutcomeA: "api_failed",
    placeOutcomeB: "filled_pending_settle",
  };
}

describe("applyArbMakeUpFromRejects", () => {
  beforeEach(() => {
    enqueueMakeUpOrder.mockReset();
    enqueueMakeUpOrder.mockResolvedValue(true);
    setPendingVenueOrder.mockReset();
    createOrder.mockReset();
    useLoseOrderStore.mockReset();
    useLoseOrderStore.mockReturnValue({
      orders: new Map(),
      setPendingVenueOrder,
      createOrder,
    });
  });

  it.each(["A", "B"] as const)("does not enqueue or observe a 9999 single leg with %s pending", async (side) => {
    const placed = basePlaced();
    placed.betBothLegs = false;
    placed.singleLegByRate = true;
    const out = await applyArbMakeUpFromRejects(params(), placed, false, false, undefined,
      { pendingConfirmA: side === "A", pendingConfirmB: side === "B" });

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
  });

  it.each(["filled", "failed", "pending"])("leaves the queue untouched when both legs are %s", async (state) => {
    const placed = basePlaced();
    placed.resultA = new BetResult("RAY", state !== "failed");
    placed.resultB = new BetResult("OB", state !== "failed");
    const out = await applyArbMakeUpFromRejects(params(), placed, false, false, undefined,
      { pendingConfirmA: state === "pending", pendingConfirmB: state === "pending" });

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
  });

  it("does not enqueue without the successful leg account", async () => {
    const placed = basePlaced();
    placed.accountB = undefined;
    expect(await applyArbMakeUpFromRejects(params(), placed, false, false))
      .toEqual({ enqueuedForLegA: false, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["A", "accepted"], ["B", "accepted"],
    ["A", "denied"], ["B", "denied"],
    ["A", "error"], ["B", "error"],
  ] as const)("preserves normal %s enqueue references and observation metadata when %s", async (side, outcome) => {
    const placed = basePlaced();
    placed.resultA = new BetResult("RAY", side !== "A");
    placed.resultB = new BetResult("OB", side !== "B");
    const anchor = side === "A" ? placed.legB : placed.legA;
    const anchorResult = side === "A" ? placed.resultB : placed.resultA;
    anchor.betMoney = 41.7;
    anchor.odds = 2.25;
    anchor.newOdds = 9.99;
    anchor.observation = { executionId: "execution", attemptId: "anchor-attempt", ownerUserId: "owner" };
    anchorResult.orderId = "anchor-order";
    const error = new Error("admission query failed");
    if (outcome === "error")
      enqueueMakeUpOrder.mockRejectedValueOnce(error);
    else
      enqueueMakeUpOrder.mockResolvedValueOnce(outcome === "accepted");

    const pending = applyArbMakeUpFromRejects(params(), placed, false, false);
    if (outcome === "error") {
      await expect(pending).rejects.toBe(error);
    }
    else {
      expect(await pending).toEqual({
        enqueuedForLegA: side === "A" && outcome === "accepted",
        enqueuedForLegB: side === "B" && outcome === "accepted",
      });
    }
    expect(enqueueMakeUpOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      target: side === "A" ? "Home" : "Away",
      accountId: side === "A" ? 23 : 14,
      betMoney: 42,
      betOdds: 2.25,
      observation: {
        executionId: "execution", parentAttemptId: "anchor-attempt", ownerUserId: "owner",
        anchorAttemptId: "anchor-attempt", anchorOrderId: "anchor-order",
      },
    }));
    expect(createOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
  });

  it.each(["missing order", "unsupported provider"])("does not fall back to new makeup when pending resume has %s", async (reason) => {
    const placed = basePlaced();
    placed.accountA = { accountId: 14, provider: reason === "missing order" ? "Polymarket" : "OB" } as never;
    placed.resultA = Object.assign(new BetResult("Polymarket", true), {
      orderId: reason === "missing order" ? null : "original-pending",
    });
    const out = await applyArbMakeUpFromRejects(params(), placed, false, false, undefined, { pendingConfirmA: true });

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["A", "target"],
    ["B", "anchor"],
  ] as const)("attaches pending %s as %s to an existing task without replacing it", async (pendingSide, role) => {
    const placed = basePlaced();
    placed.accountA = { accountId: 14, provider: "Polymarket" } as never;
    placed.accountB = { accountId: 23, provider: "Polymarket" } as never;
    placed.resultA = new BetResult("Polymarket", role === "target");
    placed.resultB = new BetResult("Polymarket", true);
    const pendingResult = pendingSide === "A" ? placed.resultA : placed.resultB;
    pendingResult.orderId = "original-pending";
    const existing = { marker: "existing task" };
    const orders = new Map([[100, existing]]);
    useLoseOrderStore.mockReturnValue({ orders, setPendingVenueOrder, createOrder });

    const out = await applyArbMakeUpFromRejects(params(), placed, false, false, undefined,
      { pendingConfirmA: pendingSide === "A", pendingConfirmB: pendingSide === "B" });

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(setPendingVenueOrder).toHaveBeenCalledWith(100, "original-pending", pendingSide === "A" ? 14 : 23,
      expect.objectContaining({ role, pendingTarget: pendingSide === "A" ? "Home" : "Away" }));
    expect(orders.get(100)).toBe(existing);
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["A", "target", true], ["A", "target", false],
    ["B", "target", true], ["B", "target", false],
    ["A", "anchor", true], ["A", "anchor", false],
    ["B", "anchor", true], ["B", "anchor", false],
  ] as const)("preserves pending %s %s handoff with admission=%s", async (pendingSide, role, eligible) => {
    const placed = basePlaced();
    placed.accountA = { accountId: 14, provider: "Polymarket" } as never;
    placed.accountB = { accountId: 23, provider: "PredictFun" } as never;
    placed.legA = new BetOption("Polymarket" as never, "m1", "b1", "h1", 40, "Home", 1.36);
    placed.legB = new BetOption("PredictFun" as never, "m2", "b2", "a1", 70, "Away", 4.095);
    placed.resultA = new BetResult("Polymarket", pendingSide === "A" || role === "target");
    placed.resultB = new BetResult("PredictFun", pendingSide === "B" || role === "target");
    const pendingResult = pendingSide === "A" ? placed.resultA : placed.resultB;
    pendingResult.orderId = "original-pending";
    enqueueMakeUpOrder.mockResolvedValueOnce(eligible);

    const out = await applyArbMakeUpFromRejects(params(), placed, false, false, undefined,
      { pendingConfirmA: pendingSide === "A", pendingConfirmB: pendingSide === "B" });

    const targetA = role === "target" ? pendingSide === "A" : pendingSide === "B";
    expect(out).toEqual({ enqueuedForLegA: targetA, enqueuedForLegB: !targetA });
    expect(enqueueMakeUpOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      target: targetA ? "Home" : "Away",
      accountId: targetA ? 23 : 14,
    }));
    expect(setPendingVenueOrder).toHaveBeenCalledExactlyOnceWith(100, "original-pending", pendingSide === "A" ? 14 : 23,
      expect.objectContaining({ role, pendingTarget: pendingSide === "A" ? "Home" : "Away", makeUpEligible: eligible }));
    expect(enqueueMakeUpOrder.mock.invocationCallOrder[0]).toBeLessThan(setPendingVenueOrder.mock.invocationCallOrder[0]);
    if (eligible) {
      expect(createOrder).not.toHaveBeenCalled();
    }
    else {
      expect(createOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        betId: 100, target: targetA ? "Home" : "Away", linkId: placed.linkId,
      }));
      expect(enqueueMakeUpOrder.mock.invocationCallOrder[0]).toBeLessThan(createOrder.mock.invocationCallOrder[0]);
      expect(createOrder.mock.invocationCallOrder[0]).toBeLessThan(setPendingVenueOrder.mock.invocationCallOrder[0]);
    }
  });

  it("propagates pending admission errors without creating a fallback task", async () => {
    const placed = basePlaced();
    placed.accountA = { accountId: 14, provider: "Polymarket" } as never;
    placed.resultA = Object.assign(new BetResult("Polymarket", true), { orderId: "original-pending" });
    const error = new Error("admission query failed");
    enqueueMakeUpOrder.mockRejectedValueOnce(error);

    await expect(applyArbMakeUpFromRejects(params(), placed, false, false, undefined, { pendingConfirmA: true }))
      .rejects.toBe(error);
    expect(createOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
  });

  it("enqueues venue-confirmed success leg reference when B wins and A fails", async () => {
    const out = await applyArbMakeUpFromRejects(
      params(),
      basePlaced(),
      false,
      false,
      {
        ordersA: [],
        ordersB: [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Home",
        betMoney: 70,
        betOdds: 4.095,
        accountId: 23,
      }),
    );
  });

  it("passes success leg orderId when resolving venue reference", async () => {
    const placed = basePlaced();
    placed.resultB = Object.assign(new BetResult("OB", true), { orderId: "0xsuccess" });

    await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      {
        ordersA: [],
        ordersB: [
          { orderId: "0xold", betMoney: 10, odds: 2.6, status: "reject" } as never,
          { orderId: "0xsuccess", betMoney: 70, odds: 4.095, status: "none" } as never,
        ],
      },
    );

    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        betMoney: 70,
        betOdds: 4.095,
      }),
    );
  });

  it("always enqueues when pairing requests makeup (B checked in enqueueMakeUpOrder)", async () => {
    const out = await applyArbMakeUpFromRejects(
      params(),
      basePlaced(),
      false,
      false,
      {
        ordersA: [],
        ordersB: [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).toHaveBeenCalled();
  });

  it("still enqueues when makeUp is disabled (A8: gate only at jb consume)", async () => {
    const p = params();
    p.config = { ...createDefaultUserConfig(), makeUp: false } as never;

    const out = await applyArbMakeUpFromRejects(
      p,
      basePlaced(),
      false,
      false,
      {
        ordersA: [],
        ordersB: [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).toHaveBeenCalled();
  });

  it("uses success leg option stake/odds (A8 Ly), not venue order", async () => {
    const placed = basePlaced();
    placed.legB.betMoney = 30;
    placed.legB.odds = 1.35;

    await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      {
        ordersA: [],
        ordersB: [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      },
    );

    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        betMoney: 30,
        betOdds: 1.35,
      }),
    );
  });

  it("enqueues when PM leg has settlement reject but venue reject flag is false", async () => {
    const placed = basePlaced();
    placed.legA = new BetOption("Polymarket" as never, "m1", "b1", "h1", 40, "Home", 1.36);
    placed.legB = new BetOption("OB" as never, "m2", "b2", "a1", 70, "Away", 4.095);
    placed.accountA = { accountId: 14 } as never;
    placed.accountB = { accountId: 23 } as never;
    placed.resultA = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xpm-unfilled",
      reject: "unfilled",
    });
    placed.resultB = new BetResult("OB", true);
    placed.placeOutcomeA = "filled_pending_settle";
    placed.placeOutcomeB = "filled_pending_settle";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      {
        ordersA: [],
        ordersB: [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 23,
        betMoney: 70,
      }),
    );
  });

  it("enqueues RAY makeup when RAY venue reject and PM filled", async () => {
    const placed = basePlaced();
    placed.legA = new BetOption("RAY" as never, "m1", "b1", "h1", 55, "Home", 2.81);
    placed.legB = new BetOption("Polymarket" as never, "m2", "b2", "a1", 26, "Away", 1.72);
    placed.resultA = new BetResult("RAY", true);
    placed.resultB = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xpm-filled",
    });
    placed.placeOutcomeA = "filled_pending_settle";
    placed.placeOutcomeB = "filled_pending_settle";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      true,
      false,
      {
        ordersA: [{ betMoney: 55, odds: 2.81, status: "reject" } as never],
        ordersB: [{ betMoney: 26, odds: 1.72, status: "none" } as never],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: true, enqueuedForLegB: false });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Home",
        accountId: 23,
        failedPlatformLabel: "RAY",
      }),
    );
  });

  it("enqueues PM makeup when OB filled and PM confirmed unfilled", async () => {
    const placed = basePlaced();
    placed.legA = new BetOption("OB" as never, "m1", "b1", "h1", 70, "Home", 2);
    placed.legB = new BetOption("Polymarket" as never, "m2", "b2", "a1", 26, "Away", 1.72);
    placed.resultA = new BetResult("OB", true);
    placed.resultB = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xpm-unfilled",
    });
    placed.placeOutcomeA = "filled_pending_settle";
    placed.placeOutcomeB = "filled_pending_settle";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      true,
      {
        ordersA: [{ betMoney: 70, odds: 2, status: "none" } as never],
        ordersB: [],
      },
    );

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: true });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Away",
        accountId: 14,
        failedPlatformLabel: "Polymarket",
      }),
    );
  });

  it("enqueues PM makeup when RAY filled and PM was never posted", async () => {
    const placed = basePlaced();
    placed.legA = new BetOption("RAY" as never, "m1", "b1", "h1", 55, "Away", 2.23);
    placed.legB = new BetOption("Polymarket" as never, "m2", "b2", "a1", 26, "Home", 1.72);
    placed.accountA = { accountId: 14 } as never;
    placed.accountB = { accountId: 23 } as never;
    placed.resultA = new BetResult("RAY", true);
    placed.resultB = undefined;
    placed.placeOutcomeA = "filled_pending_settle";
    placed.placeOutcomeB = "not_attempted";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      { ordersA: [{ betMoney: 55, odds: 2.23, status: "none" } as never], ordersB: [] },
    );

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: true });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Home",
        accountId: 14,
        failedPlatformLabel: "Polymarket",
      }),
    );
  });

  it("hangs pendingVenue resume when OB filled and PF still pendingConfirm", async () => {
    const placed = basePlaced();
    placed.accountA = { accountId: 14, provider: "OB" } as never;
    placed.accountB = { accountId: 99, provider: "PredictFun" } as never;
    placed.legA = new BetOption("OB" as never, "m1", "b1", "h1", 70, "Home", 2);
    placed.legB = new BetOption("PredictFun" as never, "m2", "b2", "a1", 26, "Away", 1.72);
    placed.resultA = new BetResult("OB", true);
    placed.resultB = Object.assign(new BetResult("PredictFun", true), {
      orderId: "0xpf-timeout",
      pending: true,
    });
    placed.placeOutcomeA = "filled_pending_settle";
    placed.placeOutcomeB = "accepted_pending_confirm";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      {
        ordersA: [{ betMoney: 70, odds: 2, status: "none" } as never],
        ordersB: [],
      },
      { pendingConfirmA: false, pendingConfirmB: true },
    );

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: true });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Away",
        accountId: 14,
        failedPlatformLabel: "PredictFun(待确认续查)",
      }),
    );
    expect(setPendingVenueOrder).toHaveBeenCalledWith(100, "0xpf-timeout", 99, expect.objectContaining({
      role: "target",
      pendingTarget: "Away",
      conditionId: "b2",
      makeUpEligible: true,
    }));
  });

  it("observes pending PM anchor when the opposite leg failed", async () => {
    const placed = basePlaced();
    placed.accountA = { accountId: 88, provider: "Polymarket" } as never;
    placed.accountB = { accountId: 23, provider: "OB" } as never;
    placed.legA = new BetOption("Polymarket" as never, "m1", "0xcondition", "h1", 25, "Home", 3.125);
    placed.legB = new BetOption("OB" as never, "m2", "b2", "a1", 70, "Away", 1.47);
    placed.resultA = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xpm-delayed",
      pending: true,
      beginTime: 1790697330729,
      request: { order: { side: "BUY", makerAmount: "25000000" } },
    });
    placed.resultB = new BetResult("OB", false, "API failed");
    placed.placeOutcomeA = "accepted_pending_confirm";
    placed.placeOutcomeB = "api_failed";

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      { ordersA: [], ordersB: [] },
      { pendingConfirmA: true, pendingConfirmB: false },
    );

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: true });
    expect(enqueueMakeUpOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "Away",
        accountId: 88,
        failedPlatformLabel: "OB(待确认续查)",
      }),
    );
    expect(setPendingVenueOrder).toHaveBeenCalledWith(100, "0xpm-delayed", 88, expect.objectContaining({
      role: "anchor",
      pmSubmission: { orderId: "0xpm-delayed", accountId: 88, stakeUsdc: 25, makerAmount: "25000000", submittedAt: 1790697330729 },
      pendingTarget: "Home",
      conditionId: "0xcondition",
      makeUpEligible: true,
    }));
  });

  it("keeps observing a pending PM order when makeup admission is denied", async () => {
    enqueueMakeUpOrder.mockResolvedValueOnce(false);
    const placed = basePlaced();
    placed.accountA = { accountId: 88, provider: "Polymarket" } as never;
    placed.accountB = { accountId: 23, provider: "OB" } as never;
    placed.legA = new BetOption("Polymarket" as never, "m1", "0xcondition", "h1", 25, "Home", 3.125);
    placed.legB = new BetOption("OB" as never, "m2", "b2", "a1", 70, "Away", 1.47);
    placed.resultA = Object.assign(new BetResult("Polymarket", true), {
      orderId: "0xpm-delayed-denied",
      pending: true,
    });
    placed.resultB = new BetResult("OB", false, "API failed");

    const out = await applyArbMakeUpFromRejects(
      params(),
      placed,
      false,
      false,
      { ordersA: [], ordersB: [] },
      { pendingConfirmA: true, pendingConfirmB: false },
    );

    expect(out).toEqual({ enqueuedForLegA: false, enqueuedForLegB: true });
    expect(createOrder).toHaveBeenCalledWith(expect.any(Object));
    expect(setPendingVenueOrder).toHaveBeenCalledWith(100, "0xpm-delayed-denied", 88, expect.objectContaining({
      role: "anchor",
      pendingTarget: "Home",
      conditionId: "0xcondition",
      makeUpEligible: false,
    }));
  });
});
