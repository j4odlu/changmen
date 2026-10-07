import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import OrderProgressStages from "@/components/order/OrderProgressStages.vue";
import { activeBetLegStages } from "./activeBetRunStages";
import { observationLegSummary } from "./activeBetRunPresentation";

const leg: ActiveBetLeg = { side: "A", target: "Home", platform: "RAY", status: "confirmed", events: [] };
const run: ActiveBetRun = { betId: 1, matchId: 1, matchTitle: "A vs B", betName: "获胜", mode: "arb", phase: "syncing", overallLabel: "自动补单已关闭", legs: [leg], events: [], startedAt: 1000, updatedAt: 2000, terminalAt: 2000 };
function event(kind: OrderObservationEvent["kind"], patch: Partial<OrderObservationEvent> = {}): OrderObservationEvent {
  return { version: 1, ownerUserId: "u1", eventId: `event-${kind}`, linkId: 1, attemptId: "initial", kind, occurredAt: 1500, sequence: 1, ...patch };
}
const rows = (events: OrderObservationEvent[], legPatch: Partial<ActiveBetLeg> = {}, runPatch: Partial<ActiveBetRun> = {}) =>
  activeBetLegStages({ ...run, ...runPatch }, { ...leg, ...legPatch }, events);
const stage = (events: OrderObservationEvent[], id: string, legPatch: Partial<ActiveBetLeg> = {}) => rows(events, legPatch).find(row => row.id === id)!;

describe("常驻编排关键阶段", () => {
  it("keeps RAY rejection detection below binding and displays the venue rejection reason", async () => {
    const facts = [event("submission_result", { provider: "RAY", outcome: "accepted" }),
      event("settlement_observed", { provider: "RAY", source: "adapter", phase: "reject_detection", outcome: "unfilled", observedStatus: "reject", safeSummary: "RAY 拒单原因：系统拒绝" }),
      event("bind_result", { outcome: "saved" })];
    const result = rows(facts, { status: "rejected" });
    const detection = result.find(row => row.id === "confirmation")!;
    expect(detection).toMatchObject({ stage: "拒单检测", label: "检测到拒单", tone: "danger" });
    expect(detection.detail).toContain("系统拒绝");
    expect(result.findIndex(row => row.id === "binding")).toBeLessThan(result.indexOf(detection));
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressStages, { stages: result }) }));
    expect(html).toContain("检测到拒单");
    expect(html).toContain("系统拒绝");
  });
  it("omits rejection detection entirely for PM matched", async () => {
    const facts = [event("submission_result", { provider: "Polymarket", outcome: "accepted", observedStatus: "matched" }),
      event("bind_result", { outcome: "saved" })];
    const result = rows(facts, { platform: "Polymarket" });
    expect(result.map(row => row.stage)).toEqual(["预检", "提交下注", "绑定订单", "补单", "编排收尾"]);
    expect(result[1]?.label).toBe("直接成交");
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressStages, { stages: result }) }));
    expect(html).not.toContain("拒单检测");
  });
  it("shows PM delayed detection before and after a venue result", () => {
    const facts = [event("submission_result", { provider: "Polymarket", outcome: "accepted", observedStatus: "delayed" }),
      event("decision", { provider: "Polymarket", phase: "reject_detection", reasonCode: "reject_detection_started" })];
    expect(stage(facts, "confirmation", { platform: "Polymarket" })).toMatchObject({ stage: "拒单检测", label: "正在拒单检测" });
    const result = rows([...facts, event("settlement_observed", { provider: "Polymarket", source: "adapter", phase: "reject_detection", outcome: "filled" })], { platform: "Polymarket" });
    expect(result[3]).toMatchObject({ stage: "拒单检测", label: "观察到成交", tone: "success" });
  });
  it("preserves the fixed-time result while a separate monitor detects a later rejection", async () => {
    const first = event("settlement_observed", { provider: "RAY", orderId: "r1", source: "adapter", outcome: "filled", observedStatus: "none" });
    expect(stage([first], "confirmation").label).toBe("拒单检测通过 · 未拒单");
    const events = [first, event("settlement_observed", { provider: "RAY", orderId: "r1", source: "ray_monitor", outcome: "unfilled", observedStatus: "reject", safeSummary: "RAY 拒单原因：系统拒绝" })];
    expect(stage(events, "confirmation").label).toBe("拒单检测通过 · 未拒单");
    expect(stage(events, "ray_monitor")).toMatchObject({ label: "监控检测到拒单", tone: "danger" });
    expect(stage(events, "ray_monitor").detail).toContain("系统拒绝");
    expect(observationLegSummary(events, "confirmed").label).toBe("检测到拒单");
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressStages, { stages: rows(events) }) }));
    expect(html).toContain("拒单检测通过 · 未拒单");
    expect(html).toContain("RAY订单监控");
    expect(html).toContain("监控检测到拒单");
  });
  it("keeps the independent monitor active after orchestration finishes and records its own end state", () => {
    const detection = event("settlement_observed", { provider: "RAY", orderId: "r1", source: "adapter", outcome: "filled", observedStatus: "none" });
    const registered = event("decision", { provider: "RAY", source: "ray_monitor", outcome: "registered" });
    const bound = event("decision", { provider: "RAY", source: "ray_monitor", outcome: "bound" });
    expect(stage([detection, registered], "ray_monitor").label).toBe("已登记 · 等待关联订单");
    expect(stage([detection, registered, bound], "ray_monitor")).toMatchObject({ label: "持续监控中", tone: "pending" });
    expect(stage([detection, registered, bound], "result").label).toBe("本轮编排已结束");
    expect(stage([detection, registered, bound, event("decision", { source: "ray_monitor", outcome: "expired" })], "ray_monitor").label).toBe("监控窗口已结束");
    expect(stage([detection, event("settlement_observed", { source: "ray_monitor", outcome: "filled", observedStatus: "win" })], "ray_monitor").label).toBe("订单已结算 · 监控结束");
    expect(stage([event("settlement_observed", { source: "adapter", outcome: "unfilled", observedStatus: "reject" })], "ray_monitor").label).toBe("未启动 · 定时检测已拒单");
  });
  it("retains all phases and distinguishes accepted submission from venue confirmation", async () => {
    const events = [event("precheck_result", { outcome: "prepared", durationMs: 120 }), event("submission_result", { outcome: "accepted", durationMs: 163 }), event("settlement_observed", { source: "orchestration_result", outcome: "filled" }), event("bind_result", { outcome: "saved" }), ...Array.from({ length: 7 }, (_, index) => event("decision", { eventId: `decision-${index}` }))];
    const result = rows(events);
    expect(result.map(row => row.stage)).toEqual(["预检", "提交下注", "绑定订单", "拒单检测", "RAY订单监控", "补单", "编排收尾"]);
    expect(result[0]).toMatchObject({ label: "预检通过", durationMs: 120 });
    expect(result[1]).toMatchObject({ label: "接口已受理", durationMs: 163 });
    expect(result[3]).toMatchObject({ label: "编排判定成交 · 缺少场馆确认记录", tone: "warning" });
    expect(result[2]?.label).toBe("已保存");
    expect(result.find(row => row.id === "result")).toMatchObject({ label: "本轮编排已结束", at: 2000 });
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressStages, { stages: result }) }));
    for (const row of result)
      expect(html).toContain(`data-stage="${row.id}"`);
    expect(html).toContain("预检通过");
    expect(html).toContain("接口已受理");
    expect(html).toContain("163ms");
  });
  it("shows timeout policy, disabled makeup and queue removal without claiming rejection or makeup success", () => {
    const events = [event("submission_result", { outcome: "accepted" }), event("settlement_observed", { source: "timeout_policy", outcome: "unfilled" }), event("queue_created", { queueId: "q1" }), event("queue_removed", { queueId: "q1" })];
    expect(stage(events, "confirmation")).toMatchObject({ label: "超时策略处理", tone: "warning" });
    expect(stage(events, "makeup").label).toBe("已出补单队列");
    expect(stage(events, "makeup").detail).toContain("不代表补单成交");
    expect(stage(events, "makeup", { events: [{ stage: "补单", detail: "自动补单已关闭，未执行", at: 1800 }] }).label).toContain("自动补单已关闭，未执行");
  });
  it("keeps venue evidence separate from orchestrated completion and detects conflicting confirmations", () => {
    const accepted = event("submission_result", { outcome: "accepted" });
    expect(stage([accepted], "confirmation").label).toBe("待场馆确认");
    const filled = event("settlement_observed", { source: "adapter", outcome: "filled" });
    expect(stage([accepted, filled], "confirmation")).toMatchObject({ label: "观察到成交", tone: "success" });
    expect(stage([filled, event("settlement_observed", { source: "adapter", outcome: "unfilled" })], "confirmation").label).toBe("确认记录冲突");
  });
  it("does not mark an unstarted submission or confirmation complete after failed precheck", () => {
    const events = [event("precheck_result", { outcome: "blocked", safeSummary: "盘口关闭" })];
    expect(stage(events, "precheck")).toMatchObject({ label: "预检失败", tone: "danger" });
    expect(stage(events, "precheck").detail).toContain("盘口关闭");
    expect(stage(events, "submission").label).toBe("未提交");
    expect(stage(events, "confirmation").label).toBe("未进入确认");
  });
  it("does not hide an actual submission start after blocked precheck", () => {
    const events = [event("precheck_result", { outcome: "blocked" }), event("submission_started")];
    expect(stage(events, "submission").label).toBe("提交处理中");
    expect(stage(events, "confirmation").label).not.toBe("未进入确认");
  });
  it("marks 9999 precheck-only and skipped legs without waiting for submission or confirmation", () => {
    const events = [event("precheck_result", { outcome: "prepared" })];
    expect(stage(events, "submission", { precheckOnly: true }).label).toBe("仅预检 · 不下单");
    expect(stage(events, "confirmation", { precheckOnly: true }).label).toBe("不参与");
    expect(stage([], "submission", { status: "skipped" }).label).toBe("不参与");
    expect(stage([], "precheck", { status: "skipped" }).label).toBe("不参与");
    expect(stage(events, "makeup", { precheckOnly: true }).label).toBe("不参与");
  });
  it("does not carry initial precheck or delayed binding into a newer retry", () => {
    const events = [event("precheck_result", { outcome: "prepared" }), event("submission_result", { attemptId: "retry-1", outcome: "unknown", retryRound: 1 }), event("bind_result", { outcome: "saved" })];
    expect(stage(events, "precheck").label).toBe("预检结果未记录");
    expect(stage(events, "submission").label).toBe("提交结果未知");
    expect(stage(events, "binding").label).toBe("尚无绑定回执");
  });
  it("does not let a delayed old queue removal override the new queue", () => {
    const events = [event("queue_created", { queueId: "old" }), event("queue_created", { queueId: "new" }), event("queue_removed", { queueId: "old" })];
    expect(stage(events, "makeup").label).toBe("已入补单队列");
  });
  it("renders old local orchestration records with their source and uses waiting labels before execution", () => {
    const local: Partial<ActiveBetLeg> = { events: [{ at: 1300, stage: "预检", detail: "预检通过" }, { at: 1400, stage: "下单", detail: "已提交" }, { at: 1500, stage: "拒单", detail: "已成交" }] };
    expect(stage([], "precheck", local).label).toBe("编排：预检通过");
    expect(stage([], "confirmation", local)).toMatchObject({ label: "编排：已成交", tone: "neutral" });
    const waiting = rows([], { status: "pending" }, { phase: "checking", terminalAt: undefined });
    expect(waiting[0]?.label).toBe("等待预检");
    expect(waiting[1]?.label).toBe("等待提交");
    expect(waiting.find(row => row.id === "result")?.label).toBe("编排进行中");
  });
});
