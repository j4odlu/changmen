import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { beginExecutionObservation, observeArbSubmissionBlocked, finishExecutionObservation } from "./orderExecutionObservation";
const mocks = vi.hoisted(() => ({ create: vi.fn(), observe: vi.fn(), order: vi.fn() }));
vi.mock("./orderObservation", () => ({ observeOption: mocks.observe, observeOrder: mocks.order, createObservationContext: mocks.create }));
const ready = () => ({ legA: { type: "RAY" }, legB: { type: "Polymarket" }, accountA: { accountId: 1 }, accountB: { accountId: 2 } }) as ArbBetReady;
beforeEach(() => vi.clearAllMocks());
describe("submission gate evidence", () => {
  it("records both unsubmitted legs with the PM validation cause", () => {
    const pair = ready();
    observeArbSubmissionBlocked(pair, "pair_submit_blocked", "PM 钱包会话已失效");
    expect(mocks.observe).toHaveBeenCalledTimes(2);
    for (const call of mocks.observe.mock.calls)
      expect(call[3]).toMatchObject({ outcome: "not_submitted", source: "orchestration", reasonCode: "pm_wallet_session_invalid" });
    expect(mocks.observe.mock.calls[0]?.slice(0, 3)).toEqual([pair.legA, pair.accountA, "submission_result"]);
  });
  it("records total-precheck timeout separately from passed leg prechecks and skips the precheck-only leg", () => {
    const pair = ready(); pair.accountA = undefined;
    observeArbSubmissionBlocked(pair, "precheck_timeout", "超时时间：3100ms，大于设定值：3000ms");
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.observe.mock.calls[0]?.[3]).toMatchObject({ reasonCode: "precheck_timeout", outcome: "not_submitted",
      safeSummary: "双腿预检总耗时超过设定上限，未提交（耗时 3100ms，上限 3000ms）" });
  });
  it("does not copy an unknown gate's raw error and cannot throw into business code", () => {
    observeArbSubmissionBlocked(ready(), "pair_submit_blocked", "unknown privateKey=SECRET");
    expect(mocks.observe.mock.calls[0]?.[3].safeSummary).toBe("双腿提交前校验未通过，整对未提交");
    mocks.observe.mockImplementationOnce(() => { throw new Error("observer offline"); });
    expect(() => observeArbSubmissionBlocked(ready(), "pair_submit_blocked", "PM 缺少本轮预检结果")).not.toThrow();
  });
  it("records a concrete GTC failure on the execution without claiming a submission result", () => {
    finishExecutionObservation(undefined, 123, "exception", "place", "GTC 实际签单数量或预算越界");
    expect(mocks.order).toHaveBeenCalledWith(undefined, 123, "execution_finished", expect.objectContaining({ phase: "place", outcome: "exception",
      reasonCode: "gtc_signed_budget_exceeded", safeSummary: "GTC 实际签单数量或含费预算超出允许范围" }));
    expect(mocks.observe).not.toHaveBeenCalled();
  });
});

describe("整轮执行观察隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    mocks.create.mockImplementation(parent => ({ ...parent, ownerUserId: "u1", attemptId: `attempt-${++counter}`, sequence: 0 }));
    mocks.order.mockImplementation(() => {});
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
    expect(mocks.order).toHaveBeenLastCalledWith(context, 123, "execution_finished", {
      source: "orchestration", outcome: "orchestration_completed", phase: "finalize",
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
    mocks.order.mockImplementation(() => { throw new Error("observer unavailable"); });
    expect(() => finishExecutionObservation(undefined, 123, "exception", "check", "SECRET")).not.toThrow();
  });
});
