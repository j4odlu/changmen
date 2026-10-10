import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import OrderProgressComparison from "@/components/order/OrderProgressComparison.vue";
import { activeBetLegStages } from "@/shared/activeBetRunStages";
import { findRealtimeGtc, mergeRealtimeGtcStages, realtimeGtcLeg, realtimeGtcMessage } from "./realtimeProgress";
import { gtcExecutionResult } from "./result";

const run: ActiveBetRun = { betId: 2, matchId: 3, linkId: 407669, matchTitle: "FaZe vs NAVI", betName: "地图1获胜",
  phase: "syncing", overallLabel: "旧编排结果", startedAt: 1000, updatedAt: 35000, terminalAt: 35000, events: [],
  legs: [{ side: "A", platform: "RAY", target: "Home", status: "confirmed", events: [] },
    { side: "B", platform: "Polymarket", target: "Away", status: "confirmed", events: [] }] };
function execution() {
  const row = createGtcExecution("gtc-1", "owner", "wallet", "maker", {
    linkId: run.linkId, betRowId: run.betId, matchId: run.matchId, originalPmLeg: "B", target: "Away",
    playerId: 11, otherPlayerId: 12, otherProvider: "RAY", otherTarget: "Home", otherOdds: 1.74, shares: "25.97",
  } as GtcPlan, 1000);
  Object.assign(row, { submit: "accepted", pmAuthorized: true, orderId: "pm-1", matched: "25.97", open: "0",
    complete: true, terminal: true, observedAt: 36000, decision: "closed", manual: true });
  row.other = { state: "filled", orderId: "ray-1", submittedAt: 2000, message: "" };
  return row;
}
const orders: OrderRow[] = [{ OrderID: "pm-1", Link: run.linkId, PlayerID: 11, Type: "Polymarket",
  Status: "None", PmGtcExecutionId: "gtc-1", PmShares: 25.97 },
{ OrderID: "ray-1", Link: run.linkId, PlayerID: 12, Type: "RAY", Status: "None", PmGtcExecutionId: "gtc-1" }];
function precheck(provider: string, target: string): OrderObservationEvent {
  return { version: 1, ownerUserId: "owner", eventId: provider, attemptId: provider, phase: "initial",
    kind: "precheck_result", sequence: 1, occurredAt: 1001, linkId: run.linkId!, outcome: "prepared", provider, target };
}

describe("GTC 实时进度使用原单事实", () => {
  it("recovers the screenshot's missing PM submit and stale RAY confirmation without fabricating timeline events", async () => {
    const row = execution();
    const facts = new Map<"A" | "B", OrderObservationEvent[]>([["A", [precheck("RAY", "Home")]], ["B", [precheck("Polymarket", "Away")]]]);
    const before = JSON.stringify({ row, orders, facts: [...facts] });
    const stages = new Map(run.legs.map(leg => [leg.side, mergeRealtimeGtcStages(
      activeBetLegStages(run, leg, facts.get(leg.side)!, orders), realtimeGtcLeg(row, leg, orders))]));
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts, orders, currentStages: stages }) }));
    expect(html).toContain("GTC 原单已受理");
    expect(html).toContain("GTC · 全部成交");
    expect(html).toContain("原单已确认");
    expect(html).toContain("成交 25.97 / 25.97 份；挂单 0 份");
    expect(html).toContain("原单已落库");
    expect(html).not.toMatch(/提交记录缺失|正在拒单检测|尚无绑定回执|缺少场馆确认记录/);
    expect(JSON.stringify({ row, orders, facts: [...facts] })).toBe(before);
  });
  it("separates acceptance, partial fills, complete fills and an incomplete group", () => {
    const row = execution(); const pm = run.legs[1]!;
    Object.assign(row, { complete: false, matched: "0", open: null });
    expect(realtimeGtcLeg(row, pm, []).tone).toBe("pending");
    Object.assign(row, { complete: true, matched: "5", open: "20.97", terminal: false });
    expect(realtimeGtcLeg(row, pm, []).label).toContain("部分成交挂单中");
    expect(realtimeGtcLeg(row, pm, []).tone).toBe("pending");
    Object.assign(row, { matched: "25.97", open: "0", terminal: true });
    expect(realtimeGtcLeg(row, pm, []).label).toBe("GTC · 全部成交");
    expect(gtcExecutionResult(row)).toMatchObject({ groupComplete: false, responsibility: "manual" });
    expect(gtcExecutionResult(row).message).toContain("PM 下单成功 · 全部成交；RAY 原单已确认");
    row.error = "原单累计量与成交明细未一致";
    expect(realtimeGtcLeg(row, pm, []).tone).toBe("warning");
    expect(realtimeGtcLeg(row, pm, []).label).toContain("成交待核实");
  });
  it("never borrows another user's, execution's, market's or direction's records", () => {
    const row = execution();
    expect(findRealtimeGtc(run, "owner", [row])?.id).toBe(row.id);
    expect(findRealtimeGtc(run, "foreign", [row])).toBeUndefined();
    expect(findRealtimeGtc({ ...run, betId: 4 }, "owner", [row])).toBeUndefined();
    expect(findRealtimeGtc({ ...run, linkId: 1 }, "owner", [row])).toBeUndefined();
    expect(findRealtimeGtc({ ...run, legs: run.legs.map(leg => ({ ...leg, target: "Home" })) }, "owner", [row])).toBeUndefined();
    expect(findRealtimeGtc(run, "owner", [row, { ...row, id: "other-execution" }])).toBeUndefined();
    const pm = run.legs[1]!;
    expect(realtimeGtcLeg(row, pm, orders).bound).toBe(true);
    for (const patch of [{ PlayerID: 99 }, { PmGtcExecutionId: "other" }, { Link: 999 }, { OrderID: "another" }, { PmSide: "sell" as const }])
      expect(realtimeGtcLeg(row, pm, [{ ...orders[0]!, ...patch }]).bound).toBe(false);
  });
  it("keeps a never-submitted PM leg and an accepted counterpart pending", () => {
    const row = execution();
    Object.assign(row, { pmAuthorized: false, submit: "not_attempted", orderId: null, matched: "0", principal: "0", open: "0" });
    row.other.state = "pending";
    const pm = realtimeGtcLeg(row, run.legs[1]!, []);
    expect(pm.stages.find(stage => stage.id === "submission")?.label).toBe("未提交");
    expect(realtimeGtcLeg(row, run.legs[0]!, []).label).toBe("原单待确认");
  });
  it("shows both current legs when one leg's observation events have been lost", async () => {
    const row = execution();
    const facts = new Map<"A" | "B", OrderObservationEvent[]>([["A", [precheck("RAY", "Home")]]]);
    const stages = new Map(run.legs.map(leg => [leg.side, mergeRealtimeGtcStages(
      activeBetLegStages(run, leg, facts.get(leg.side) || [], orders), realtimeGtcLeg(row, leg, orders))]));
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts, orders, currentStages: stages }) }));
    expect(html).toContain("当前原单进度");
    expect(html).toContain("GTC 原单已受理");
    expect(html).toContain("GTC · 全部成交");
    expect(html).not.toContain("本腿无此轮尝试");
  });
  it("retains an accepted submission receipt's time even when the original order is rejected later", () => {
    const row = execution(); row.other.state = "rejected";
    const submit = { ...precheck("RAY", "Home"), kind: "submission_result" as const,
      outcome: "accepted", accountId: 12, orderId: "ray-1", occurredAt: 2000, durationMs: 141 };
    const stages = mergeRealtimeGtcStages(activeBetLegStages(run, run.legs[0]!, [submit]), realtimeGtcLeg(row, run.legs[0]!, []));
    expect(stages.find(stage => stage.id === "submission")).toMatchObject({ label: "接口已受理", at: 2000, durationMs: 141, tone: "success" });
    expect(stages.find(stage => stage.id === "confirmation")?.tone).toBe("danger");
    const unknown = { ...submit, outcome: "unknown", provider: "Polymarket", accountId: 11, orderId: "pm-1" };
    const pmStages = mergeRealtimeGtcStages(activeBetLegStages(run, run.legs[1]!, [unknown]), realtimeGtcLeg(row, run.legs[1]!, orders));
    expect(pmStages.find(stage => stage.id === "submission")?.label).toBe("GTC 原单已受理");
    expect(pmStages.find(stage => stage.id === "submission")?.at).toBeUndefined();
  });
  it("prioritizes an exact current rejection/return over a stale successful orchestration", () => {
    const row = execution(); row.groupComplete = true; row.manual = false; row.released = true;
    const before = JSON.stringify(row);
    for (const status of ["Reject", "Return"] as const) {
      const rejectedOrders = [orders[0]!, { ...orders[1]!, Status: status }];
      const leg = realtimeGtcLeg(row, run.legs[0]!, rejectedOrders);
      expect(leg.tone).toBe("danger");
      expect(leg.label).toBe(status === "Reject" ? "原单拒单" : "原单退回");
      expect(leg.stages.find(stage => stage.id === "submission")?.tone).toBe("success");
      expect(leg.stages.find(stage => stage.id === "result")?.detail).not.toContain("本组已完成");
      expect(realtimeGtcMessage(row, rejectedOrders)).toContain("本组需重新核查");
      const foreign = [{ ...rejectedOrders[1]!, PmGtcExecutionId: "foreign-execution" }];
      expect(realtimeGtcMessage(row, foreign)).toContain("本组已完成");
      expect(realtimeGtcLeg(row, run.legs[0]!, foreign).tone).toBe("success");
    }
    expect(JSON.stringify(row)).toBe(before);
  });
});
