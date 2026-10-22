import type { PlatformId } from "@/types/esport";
import type { AcceptedMakeUpLegContext } from "./makeUpAccepted";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { LoseOrder } from "@/models/loseOrder";
import { PlatformAccount } from "@/models/platformAccount";
import { processPmMakeUpLeg } from "./loseOrderPm";
import { processA8RegularVenueMakeUpLeg } from "./loseOrderRegular";
import { completeAcceptedMakeUpLeg } from "./makeUpAccepted";

vi.mock("./loseOrderPm", () => ({ processPmMakeUpLeg: vi.fn() }));
vi.mock("./loseOrderRegular", () => ({ processA8RegularVenueMakeUpLeg: vi.fn() }));

const now = 1_800_000_000_000;

function setup(provider: PlatformId = "OB") {
  const trace: unknown[] = [];
  const order = new LoseOrder({ betId: 100, matchId: 1, betMoney: 100, betOdds: 2, target: "Home", linkId: 1000 });
  const account = new PlatformAccount({ accountId: 7, provider, currency: "CNY" });
  const checked = new BetOption(provider, "m1", "b1", "token", 14.25, "Home", 2);
  checked.newOdds = 2.3;
  const result = new BetResult(provider, true);
  result.orderId = "original-order";
  result.request = { order: { side: "BUY", makerAmount: "14250000", takerAmount: "28500000" } };
  const save = vi.fn((...args: unknown[]) => { trace.push(["receipt", ...args]); });
  const ctx: AcceptedMakeUpLegContext = {
    betId: 100, order, account, checked, result, item: { type: provider },
    match: { id: 1 } as AcceptedMakeUpLegContext["match"],
    bet: { id: 100 } as AcceptedMakeUpLegContext["bet"],
    isCurrentOrder: true, waitSec: 10,
    accountStore: {} as AcceptedMakeUpLegContext["accountStore"],
    loseStore: { setPendingVenueOrder: save } as unknown as AcceptedMakeUpLegContext["loseStore"],
    removeIds: new Set(), setMessage: vi.fn(),
  };
  vi.mocked(processPmMakeUpLeg).mockImplementation((params) => { trace.push(["pending", params]); return Promise.resolve(); });
  vi.mocked(processA8RegularVenueMakeUpLeg).mockImplementation((params) => { trace.push(["regular", params]); return Promise.resolve(false); });
  return { ctx, trace, save };
}

describe("completeAcceptedMakeUpLeg", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("persists the original regular receipt before confirmation and passes original object references", async () => {
    const { ctx, trace, save } = setup();
    await completeAcceptedMakeUpLeg(ctx);
    expect(save).toHaveBeenCalledExactlyOnceWith(100, "original-order", 7, {
      role: "target", pendingTarget: "Home", observation: ctx.checked.observation,
      conditionId: "b1", submittedAt: now, odds: 2, betMoney: 14.25,
      regularReceipt: { checkAt: now + 10_000 },
    });
    expect(trace.map(event => (event as unknown[])[0])).toEqual(["receipt", "regular"]);
    const passed = vi.mocked(processA8RegularVenueMakeUpLeg).mock.calls[0]![0];
    for (const key of ["order", "bet", "account", "checked", "result", "accountStore", "removeIds", "setMessage"] as const)
      expect(passed[key]).toBe(ctx[key]);
    expect(processPmMakeUpLeg).not.toHaveBeenCalled();
  });

  it.each(["Polymarket", "PredictFun"] as const)("persists %s odds and submission metadata before pending confirmation", async (provider) => {
    const { ctx, trace, save } = setup(provider);
    await completeAcceptedMakeUpLeg(ctx);
    expect(save).toHaveBeenCalledWith(100, "original-order", 7, {
      role: "target", pendingTarget: "Home", observation: ctx.checked.observation,
      conditionId: "b1", submittedAt: now, odds: 2.3, betMoney: 14.25,
      pmSubmission: provider === "Polymarket" ? pmSubmissionFromResult(ctx.result, 7) : null,
    });
    expect(trace.map(event => (event as unknown[])[0])).toEqual(["receipt", "pending"]);
    const passed = vi.mocked(processPmMakeUpLeg).mock.calls[0]![0];
    for (const key of ["order", "match", "bet", "account", "checked", "result", "loseStore", "removeIds", "setMessage"] as const)
      expect(passed[key]).toBe(ctx[key]);
    expect(processA8RegularVenueMakeUpLeg).not.toHaveBeenCalled();
  });

  it.each(["OB", "Polymarket", "PredictFun"] as const)("continues accepted %s confirmation after cancellation without writing a replacement queue entry", async (provider) => {
    const { ctx, save } = setup(provider);
    ctx.isCurrentOrder = false;
    ctx.order.isCreateOrder = true;
    ctx.waitSec = 0;
    await completeAcceptedMakeUpLeg(ctx);
    expect(save).not.toHaveBeenCalled();
    expect(provider === "OB" ? processA8RegularVenueMakeUpLeg : processPmMakeUpLeg).toHaveBeenCalledOnce();
  });

  it.each(["OB", "Polymarket", "PredictFun"] as const)("continues %s confirmation when receipt persistence throws", async (provider) => {
    const { ctx, save } = setup(provider);
    save.mockImplementation(() => { throw new Error("persistence unavailable"); });
    await completeAcceptedMakeUpLeg(ctx);
    expect(save).toHaveBeenCalledOnce();
    expect(provider === "OB" ? processA8RegularVenueMakeUpLeg : processPmMakeUpLeg).toHaveBeenCalledOnce();
  });

  it.each(["OB", "Polymarket", "PredictFun"] as const)("returns the original %s confirmation promise without an extra async layer", async (provider) => {
    const { ctx } = setup(provider);
    const original = Promise.resolve(false);
    if (provider === "OB")
      vi.mocked(processA8RegularVenueMakeUpLeg).mockReturnValue(original);
    else
      vi.mocked(processPmMakeUpLeg).mockReturnValue(original.then(() => undefined));
    const promise = completeAcceptedMakeUpLeg(ctx);
    const handler = provider === "OB" ? processA8RegularVenueMakeUpLeg : processPmMakeUpLeg;
    expect(promise).toBe(vi.mocked(handler).mock.results[0]!.value);
    await promise;
  });

  it.each(["OB", "Polymarket", "PredictFun"] as const)("propagates %s confirmation failures to the original caller", async (provider) => {
    const { ctx } = setup(provider);
    const error = new Error("confirmation failed");
    if (provider === "OB")
      vi.mocked(processA8RegularVenueMakeUpLeg).mockRejectedValue(error);
    else
      vi.mocked(processPmMakeUpLeg).mockRejectedValue(error);
    await expect(completeAcceptedMakeUpLeg(ctx)).rejects.toBe(error);
  });

  it("matches original receipt payloads, routing and synchronous call order for 1152 scenarios", async () => {
    const entry = JSON.parse(readFileSync(new URL("../../../../../scripts/verification/makeup-accepted-extraction.json", import.meta.url), "utf8"));
    const legacy = runInNewContext(`(async function ({ betId, order, match, bet, item, account, checked, result, isCurrentOrder, waitSec, accountStore, loseStore, removeIds, setMessage }) { ${entry.changes[2][1].replace("continue;", "return;")} })`,
      { Date, isPendingConfirmVenueProvider, isPolymarketProvider, pmSubmissionFromResult, processPmMakeUpLeg, processA8RegularVenueMakeUpLeg }) as typeof completeAcceptedMakeUpLeg;
    let count = 0;
    for (const provider of ["OB", "RAY", "Polymarket", "PredictFun"] as const)
      for (const current of [false, true]) for (const manual of [false, true]) for (const wait of [0, 10, -1])
        for (const target of ["Home", "Away"] as const) for (const throws of [false, true])
          for (const newOdds of [undefined, 0, 2.3]) for (const orderId of [null, "original-order"]) {
            const { ctx, trace, save } = setup(provider);
            ctx.isCurrentOrder = current;
            ctx.order.isCreateOrder = manual;
            ctx.order.target = target;
            ctx.waitSec = wait;
            ctx.checked.newOdds = newOdds;
            ctx.result.orderId = orderId;
            save.mockImplementation((...args) => { trace.push(["receipt", ...args]); if (throws) throw new Error("storage"); });
            Object.freeze(ctx.order);
            Object.freeze(ctx.checked);
            Object.freeze(ctx.result);
            Object.freeze(ctx);
            const expectedPromise = legacy(ctx);
            const expected = trace.splice(0);
            await expectedPromise;
            const actualPromise = completeAcceptedMakeUpLeg(ctx);
            expect(trace).toEqual(expected);
            await actualPromise;
            count++;
          }
    expect(count).toBe(1152);
  });
});
