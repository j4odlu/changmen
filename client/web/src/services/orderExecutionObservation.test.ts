import type { ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginExecutionObservation, finishExecutionObservation } from "./orderExecutionObservation";

const mocks = vi.hoisted(() => ({ create: vi.fn(), observe: vi.fn() }));
vi.mock("./orderObservation", () => ({ createObservationContext: mocks.create, observeOrder: mocks.observe }));

describe("整轮执行观察隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    mocks.create.mockImplementation(parent => ({ ...parent, ownerUserId: "u1", attemptId: `attempt-${++counter}`, sequence: 0 }));
    mocks.observe.mockImplementation(() => {});
  });
  it("shares execution identity across distinct legs and only reports orchestration completion", () => {
    const ready = { linkId: 123, legA: { betMoney: 10 }, legB: { betMoney: 20 } } as unknown as ArbBetReady;
    const context = beginExecutionObservation(ready);
    expect(context?.attemptId).toBeUndefined();
    expect(ready.legA.observation?.executionId).toBe(context?.executionId);
    expect(ready.legB.observation?.executionId).toBe(context?.executionId);
    expect(ready.legA.observation?.attemptId).not.toBe(ready.legB.observation?.attemptId);
    expect(ready.legA.betMoney).toBe(10);
    finishExecutionObservation(context, 123, "orchestration_completed", "finalize");
    expect(mocks.observe).toHaveBeenLastCalledWith(context, 123, "execution_finished", {
      source: "orchestration",
      outcome: "orchestration_completed",
      phase: "finalize",
    });
  });
  it("continues observing the other leg when a leg is immutable", () => {
    const ready = { linkId: 123, legA: Object.freeze({}), legB: {} } as ArbBetReady;
    const context = beginExecutionObservation(ready);
    expect(context?.executionId).toBeTruthy();
    expect(ready.legB.observation?.executionId).toBe(context?.executionId);
  });
  it("cannot propagate observation faults to business cleanup", () => {
    mocks.create.mockImplementation(() => { throw new Error("observer unavailable"); });
    expect(beginExecutionObservation({} as ArbBetReady)).toBeUndefined();
    mocks.observe.mockImplementation(() => { throw new Error("observer unavailable"); });
    expect(() => finishExecutionObservation(undefined, 123, "exception", "check", "SECRET")).not.toThrow();
  });
});
