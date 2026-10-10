import type { GtcFacts, GtcFill, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution, gtcCanAuthorizeOther, gtcCanCancel, gtcCanFinishWithoutOrders, gtcCanRelease, gtcStateLabel, gtcUnits, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { describe, expect, it } from "vitest";

export const plan: GtcPlan = {
  playerId: 1,
  otherPlayerId: 2,
  originalPmLeg: "A",
  otherProvider: "RAY",
  otherTarget: "Away",
  otherOdds: 2,
  otherStake: 100,
  otherVenueMatchId: "match",
  otherVenueItemId: "away",
  matchId: 1,
  betRowId: 2,
  linkId: 3,
  tokenId: "token",
  conditionId: "condition",
  target: "Home",
  match: "m",
  bet: "b",
  item: "i",
  shares: "10",
  targetShares: "10",
  price: "0.5",
  maxPrincipal: "5",
  allInBudget: "5",
  feeProof: { rate: "0", exponent: 1, takerOnly: true, observedAt: 1 },
  fx: 6.7,
  parallel: false,
  protocol: 2,
  negRisk: false,
  route: "direct",
  orderHash: `0x${"a".repeat(64)}`,
};
const create = () => createGtcExecution("id", "owner", "wallet", "maker", plan, 1);
export function fill(q = "5", status = "CONFIRMED", time = 3): GtcFill {
  return { key: "t:maker", tradeId: "t", bucket: "maker", role: "MAKER", shares: q, price: "0.5", fee: "0", status, updatedAt: time };
}
export function facts(q = "5", status = "LIVE", fills: GtcFill[] = [fill(q)]): GtcFacts {
  return { order: { id: plan.orderHash, original: "10.0", matched: q, status, tradeIds: fills.map(f => f.tradeId) }, fills, complete: true, observedAt: 4 };
}
function accepted() { return applyGtcCommand(applyGtcCommand(create(), { kind: "authorize_pm" }, 1), { kind: "ack", state: "accepted", orderId: plan.orderHash }, 2); }

describe("manual GTC source", () => {
  function manual() { const row = accepted(); row.plan.source = "manual"; return applyGtcCommand(row, { kind: "close" }, 3); }
  it("never authorizes a second leg, including parallel/source-role variants", () => {
    const row = manual(); row.plan.parallel = true; row.plan.originalPmLeg = "B";
    expect(gtcCanAuthorizeOther(row, 4)).toBe(false);
    expect(() => applyGtcCommand(row, { kind: "authorize_other" }, 4)).toThrow();
    expect(() => applyGtcCommand(row, { kind: "other", state: "filled" }, 4)).toThrow("手动 GTC");
  });
  it("accepted zero stays open after closing the one-send window", () => {
    const row = mergeGtcFacts(manual(), facts("0", "LIVE", []));
    expect(row.released).toBe(false); expect(row.open).toBe("10"); expect(row.submit).toBe("accepted");
  });
  it("definitive rejection frees a manual reservation while keeping the rejection reason", () => {
    const row = structuredClone(create()); row.plan.source = "manual";
    const rejected = applyGtcCommand(applyGtcCommand(row, { kind: "authorize_pm" }, 1), { kind: "ack", state: "rejected", message: "market closed" }, 2);
    const closed = applyGtcCommand(rejected, { kind: "close" }, 3);
    expect(closed.released).toBe(true); expect(closed.error).toBe("market closed");
  });
  it("full MATCHED waits for confirmation, then releases without an automatic-betting resume", () => {
    const matched = mergeGtcFacts(manual(), facts("10", "MATCHED", [fill("10", "MATCHED", 4)]));
    expect(matched.released).toBe(false);
    const confirmed = mergeGtcFacts(matched, facts("10", "MATCHED", [fill("10", "CONFIRMED", 5)]));
    expect(confirmed.released).toBe(true); expect(confirmed.other.state).toBe("not_attempted");
  });
  it("confirmed partial fill plus verified cancellation releases the manual reservation", () => {
    const row = mergeGtcFacts(manual(), facts("5", "CANCELED"));
    expect(row.released).toBe(true); expect(row.matched).toBe("5"); expect(row.open).toBe("0");
  });
  it("late correction after release restores hold", () => {
    const completed = mergeGtcFacts(manual(), facts("10", "MATCHED", [fill("10", "CONFIRMED", 4)]));
    const failed = mergeGtcFacts(completed, facts("0", "LIVE", [fill("10", "FAILED", 5)]));
    expect(failed.released).toBe(false); expect(failed.matched).toBe("0");
  });
});
describe("gTC V1 durable state decisions", () => {
  function otherFirstFailure() {
    const initial = create(); initial.plan = { ...initial.plan, originalPmLeg: "B" };
    return applyGtcCommand(applyGtcCommand(initial, { kind: "authorize_other" }, 2), { kind: "other", state: "rejected", message: "赔率下降至1.84" }, 3);
  }
  it("other-first rejection closes unsubmitted PM as not_attempted and frees an empty group", () => {
    const row = applyGtcCommand(otherFirstFailure(), { kind: "close" }, 4);
    expect(row).toMatchObject({ submit: "not_attempted", pmAuthorized: false, orderId: null, released: true, manual: false, open: "0", groupComplete: false });
    expect(row.other.message).toBe("赔率下降至1.84"); expect(gtcStateLabel(row)).toBe("未提交 · 本次执行已结束");
    expect(gtcCanCancel(row)).toBe(false); expect(() => applyGtcCommand(row, { kind: "authorize_pm" }, 5)).toThrow();
  });
  it("legacy rejected label without a PM authorization can be corrected by close", () => {
    const legacy = otherFirstFailure(); legacy.submit = "rejected"; legacy.terminal = true; legacy.complete = true; legacy.open = "0";
    expect(gtcCanFinishWithoutOrders(legacy)).toBe(true); expect(gtcStateLabel(legacy)).not.toContain("拒单");
    const corrected = applyGtcCommand(legacy, { kind: "close" }, 4);
    expect(corrected.submit).toBe("not_attempted"); expect(corrected.released).toBe(true);
  });
  it.each(["authorized", "accepted", "pending", "filled", "unknown"] as const)("unsubmitted PM does not free another leg with state %s", (state) => {
    const row = otherFirstFailure(); row.other.state = state;
    const closed = applyGtcCommand(row, { kind: "close" }, 4);
    expect(closed.submit).toBe("not_attempted"); expect(closed.released).toBe(false); expect(closed.manual).toBe(true);
  });
  it("an order id or PM authorization prevents legacy empty-group cleanup", () => {
    const otherId = otherFirstFailure(); otherId.other.orderId = "ray-order";
    expect(applyGtcCommand(otherId, { kind: "close" }, 4).released).toBe(false);
    const pmId = otherFirstFailure(); pmId.orderId = plan.orderHash;
    expect(gtcCanFinishWithoutOrders(pmId)).toBe(false);
    const dispatched = applyGtcCommand(create(), { kind: "authorize_pm" }, 2);
    expect(applyGtcCommand(dispatched, { kind: "close" }, 4)).toMatchObject({ submit: "dispatching", released: false });
  });
  it("a real PM rejection retains its distinct rejected status", () => {
    const dispatched = applyGtcCommand(create(), { kind: "authorize_pm" }, 2);
    const row = applyGtcCommand(applyGtcCommand(dispatched, { kind: "ack", state: "rejected", message: "market closed" }, 3), { kind: "close" }, 4);
    expect(row.submit).toBe("rejected"); expect(gtcStateLabel(row)).toBe("下单失败 · 明确拒单"); expect(gtcCanFinishWithoutOrders(row)).toBe(false);
  });
  it("accepted zero is successful placement, not a fill and not second-leg permission", () => {
    const row = mergeGtcFacts(accepted(), facts("0", "LIVE", []));
    expect(gtcStateLabel(row)).toBe("下单成功 · 未成交挂单中"); expect(row.open).toBe("10");
    expect(gtcCanAuthorizeOther(row, 3)).toBe(false); expect(row.counted).toBe(false);
  });
  it("positive initial execution authorizes original second leg exactly once", () => {
    const row = mergeGtcFacts(accepted(), facts());
    const after = applyGtcCommand(row, { kind: "authorize_other" }, 3);
    expect(after.other.state).toBe("authorized"); expect(() => applyGtcCommand(after, { kind: "authorize_other" }, 4)).toThrow();
  });
  it("unknown POST cannot be resent, including restart from serialized state", () => {
    const row = applyGtcCommand(accepted(), { kind: "ack", state: "unknown" }, 3);
    expect(() => applyGtcCommand(JSON.parse(JSON.stringify(row)), { kind: "authorize_pm" }, 4)).toThrow();
  });
  it("late full maker fill never opens a manually closed second leg", () => {
    const closed = applyGtcCommand(mergeGtcFacts(accepted(), facts("0", "LIVE", [])), { kind: "close" }, 3);
    const late = mergeGtcFacts(closed, facts("10", "MATCHED", [fill("10")]));
    expect(gtcCanAuthorizeOther(late, 4)).toBe(false); expect(late.manual).toBe(true); expect(late.groupComplete).toBe(false);
  });
  it("decision deadline is independent of notification wait", () => {
    const row = mergeGtcFacts(accepted(), facts()); expect(gtcCanAuthorizeOther(row, 10001)).toBe(false);
  });
  it("cancel intent wins before later second-leg authorization", () => {
    const row = applyGtcCommand(mergeGtcFacts(accepted(), facts()), { kind: "cancel", commandId: "c" }, 3);
    expect(row.decision).toBe("closed"); expect(() => applyGtcCommand(row, { kind: "authorize_other" }, 4)).toThrow();
  });
  it("cancel HTTP acknowledgement alone cannot release wallet", () => {
    const row = applyGtcCommand(mergeGtcFacts(accepted(), facts()), { kind: "cancel", commandId: "c" }, 3);
    const after = applyGtcCommand(row, { kind: "cancel_result", commandId: "c", state: "unknown", message: "ack" }, 4);
    expect(gtcCanRelease(after)).toBe(false); expect(after.open).toBe("5");
  });
  it("fills during cancellation remain booked and cancellation survives old LIVE replay", () => {
    let row = mergeGtcFacts(accepted(), facts("5", "CANCELED"));
    row = mergeGtcFacts(row, facts("5", "LIVE"));
    expect(row.open).toBe("0"); expect(row.matched).toBe("5"); expect(row.principal).toBe("2.5");
  });
  it("repeated snapshots never double-count a trade", () => {
    const row = mergeGtcFacts(mergeGtcFacts(accepted(), facts()), facts());
    expect(row.matched).toBe("5"); expect(row.principal).toBe("2.5"); expect(row.fee).toBe("0");
  });
  it("missing trade details and truncated pagination stay incomplete", () => {
    const f = facts(); f.fills = []; expect(mergeGtcFacts(accepted(), f).complete).toBe(false);
    const truncated = { ...facts(), complete: false }; expect(mergeGtcFacts(accepted(), truncated).complete).toBe(false);
  });
  it("maker zero fee remains real zero; unknown fee never becomes zero", () => {
    expect(mergeGtcFacts(accepted(), facts()).fee).toBe("0");
    const f = fill(); f.fee = null; const row = mergeGtcFacts(accepted(), facts("5", "LIVE", [f]));
    expect(row.fee).toBeNull(); expect(row.complete).toBe(false);
  });
  it("fAILED corrects quantities downward and old MATCHED cannot resurrect it", () => {
    let row = mergeGtcFacts(accepted(), facts()); row = mergeGtcFacts(row, facts("0", "LIVE", [fill("5", "FAILED", 5)]));
    row = mergeGtcFacts(row, facts("5", "LIVE", [fill("5", "MATCHED", 3)]));
    expect(row.matched).toBe("0"); expect(row.principal).toBe("0"); expect(row.complete).toBe(false);
  });
  it("order identity and original quantity mismatch fail closed", () => {
    const f = facts(); f.order!.id = "foreign"; expect(() => mergeGtcFacts(accepted(), f)).toThrow();
    f.order!.id = plan.orderHash; f.order!.original = "11"; expect(() => mergeGtcFacts(accepted(), f)).toThrow();
  });
  it("unknown remaining quantity permits cancel of known accepted original", () => {
    const row = accepted(); expect(row.open).toBeNull(); expect(gtcCanCancel(row)).toBe(true);
    row.orderId = null; expect(gtcCanCancel(row)).toBe(false);
  });
  it("delayed is accepted but cannot be canceled until official state permits", () => {
    const row = mergeGtcFacts(accepted(), facts("0", "DELAYED", [])); expect(gtcCanCancel(row)).toBe(false);
  });
  it("full MATCHED still waits for trade settlement before release", () => {
    let row = mergeGtcFacts(accepted(), facts("10", "MATCHED", [fill("10", "MATCHED")]));
    row = applyGtcCommand(row, { kind: "authorize_other" }, 3);
    row = applyGtcCommand(row, { kind: "other", state: "filled" }, 4);
    row = applyGtcCommand(row, { kind: "close" }, 5); expect(row.released).toBe(false);
    row = mergeGtcFacts(row, facts("10", "MATCHED", [fill("10", "CONFIRMED", 6)])); expect(row.released).toBe(true);
  });
  it("manual resume does not clear manual or reopen original group", () => {
    let row = applyGtcCommand(mergeGtcFacts(accepted(), facts("0", "CANCELED", [])), { kind: "close" }, 3);
    row = applyGtcCommand(row, { kind: "resume" }, 4); expect(row.released).toBe(true); expect(row.manual).toBe(true); expect(row.decision).toBe("closed");
  });
  it("late correction after release restores wallet hold", () => {
    let row = applyGtcCommand(mergeGtcFacts(accepted(), facts("0", "CANCELED", [])), { kind: "close" }, 3);
    row = applyGtcCommand(row, { kind: "resume" }, 4);
    row = mergeGtcFacts(row, { order: null, fills: [], complete: false, observedAt: 5, error: "read failed" }); expect(row.released).toBe(false);
  });
  it("rejects unsafe decimal shapes", () => { for (const value of ["-1", "NaN", "1e3", "0.0000001", ""]) expect(() => gtcUnits(value)).toThrow(); });
});
