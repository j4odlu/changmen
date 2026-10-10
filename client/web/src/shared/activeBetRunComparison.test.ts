import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetRun } from "@/types/activeBetRun";
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import OrderProgressComparison from "@/components/order/OrderProgressComparison.vue";
import { activeBetRunComparison } from "./activeBetRunComparison";
import { activeBetRunComparisonTimeline } from "./activeBetRunComparisonTimeline";

const run: ActiveBetRun = {
  betId: 1, matchId: 1, matchTitle: "A vs B", betName: "获胜", phase: "makeup", overallLabel: "补单中", startedAt: 1000, updatedAt: 2000,
  legs: [
    { side: "A", target: "Home", platform: "RAY", status: "confirmed", events: [] },
    { side: "B", target: "Away", platform: "Polymarket", status: "makeup", events: [] },
  ], events: [],
};
function event(kind: OrderObservationEvent["kind"], patch: Partial<OrderObservationEvent> = {}): OrderObservationEvent {
  return { version: 1, ownerUserId: "u1", eventId: `event-${kind}`, linkId: 1, attemptId: "initial", phase: "initial", kind, occurredAt: 1500, sequence: 1, ...patch };
}
const facts = () => new Map<"A" | "B", OrderObservationEvent[]>([
  ["A", [event("precheck_result", { provider: "RAY", outcome: "prepared", durationMs: 158 }), event("submission_result", { provider: "RAY", outcome: "accepted" }),
    event("settlement_observed", { provider: "RAY", source: "adapter", outcome: "filled", observedStatus: "none" })]],
  ["B", [event("precheck_result", { provider: "Polymarket", outcome: "prepared" }), event("submission_result", { provider: "Polymarket", orderId: "pm-initial", outcome: "accepted", observedStatus: "delayed" }),
    event("settlement_observed", { provider: "Polymarket", orderId: "pm-initial", source: "timeout_policy", outcome: "unfilled" }),
    event("precheck_result", { attemptId: "makeup-1", phase: "makeup", provider: "Polymarket", outcome: "blocked", durationMs: 1496, safeSummary: "当前卖价高于检测限价，已阻止提交（卖价 0.32，限价 0.303）" })]],
]);

describe("双腿按阶段对照", () => {
  it("keeps timeline events in their own leg, attempt and stage, including late receipts and unscoped facts", () => {
    const events = facts();
    const late = event("bind_result", { eventId: "late-bind", provider: "Polymarket", outcome: "saved" });
    const queue = event("queue_created", { eventId: "queue", attemptId: undefined, queueId: "q", phase: "makeup" });
    const gap = event("transport_gap", { eventId: "gap", attemptId: undefined });
    const unscoped = event("precheck_result", { eventId: "unscoped", attemptId: undefined });
    const monitor = event("settlement_observed", { eventId: "monitor", source: "ray_monitor", provider: "RAY", outcome: "unfilled" });
    events.get("B")!.push(late, queue, gap, unscoped);
    events.get("A")!.push(monitor);
    const groups = activeBetRunComparison(run, events);
    const timelines = activeBetRunComparisonTimeline(run, events, groups);
    expect(timelines.get("initial:1")?.get("binding")?.get("B")).toEqual([late]);
    expect(timelines.get("makeup:1")?.get("precheck")?.get("B")?.[0]?.attemptId).toBe("makeup-1");
    expect(timelines.get("makeup:1")?.get("precheck")?.get("A")).toBeUndefined();
    expect(timelines.get("initial:1")?.get("ray_monitor")?.get("A")).toEqual([monitor]);
    expect(timelines.get("orchestration")?.get("makeup")?.get("B")).toEqual([queue]);
    expect(timelines.get("orchestration")?.get("result")?.get("B")).toEqual([gap, unscoped]);
    const assigned = [...timelines.values()].flatMap(rows => [...rows.values()].flatMap(sides => [...sides.values()].flat()));
    expect(assigned).toHaveLength([...events.values()].flat().length);
    expect(new Set(assigned)).toEqual(new Set([...events.values()].flat()));
  });
  it("adds stage timeline controls with timestamps, account names and complete history on expansion", async () => {
    const events = Array.from({ length: 8 }, (_, index) => event("precheck_started", {
      eventId: `check-${index}`, occurredAt: 1000 + index * 10, accountId: 42,
      safeSummary: `预检过程 ${index}`, sequence: index + 1,
    }));
    const props = { run, facts: new Map<"A" | "B", OrderObservationEvent[]>([["A", events]]), accountName: () => "测试账号" };
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, props) }));
    const precheck = html.match(/<tr data-stage="precheck">([\s\S]*?)<\/tr>/)![1]!;
    expect(precheck).toContain("执行时间线 · 8 条");
    expect(precheck).toContain("账号 测试账号");
    expect(precheck).toContain("+70ms");
    expect(precheck).not.toContain("预检过程 0");
    const expanded = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { ...props, expandedTimeline: true }) }));
    expect(expanded).toContain('active-bet-run__comparison-events" open');
    expect(expanded).toContain("预检过程 0");
    expect(expanded).toContain("预检过程 7");
  });
  it("keeps GTC current stages intact while retaining every historical event", async () => {
    const events = facts();
    const baseline = activeBetRunComparison(run, events);
    const currentStages = new Map(run.legs.map((leg, index) => [leg.side, baseline[0]!.rows.map(row => row.cells[index]!)]));
    const groups = activeBetRunComparison(run, events, [], [], currentStages);
    const before = JSON.stringify(groups);
    const timelines = activeBetRunComparisonTimeline(run, events, groups);
    expect(timelines.get("current")?.get("precheck")?.get("B")?.map(event => event.attemptId)).toEqual(["initial", "makeup-1"]);
    expect(JSON.stringify(groups)).toBe(before);
    expect([...timelines.values()].flatMap(rows => [...rows.values()].flatMap(sides => [...sides.values()].flat()))).toHaveLength([...events.values()].flat().length);
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts: events, currentStages }) }));
    const precheck = html.match(/<tr data-stage="precheck">([\s\S]*?)<\/tr>/)![1]!;
    expect(precheck).toContain("首轮尝试 ·");
    expect(precheck).toContain("补单第 1 次 ·");
  });
  it("shows both legs unsubmitted when the same execution is blocked in precheck", async () => {
    const events = new Map<"A" | "B", OrderObservationEvent[]>([
      ["A", [event("precheck_result", { executionId: "blocked-run", provider: "RAY", outcome: "prepared", odds: 2.48 })]],
      ["B", [event("precheck_result", { executionId: "blocked-run", provider: "Polymarket", outcome: "blocked", odds: 1.886,
        safeSummary: "当前卖价高于检测限价（卖价 0.63，限价 0.53）" })]],
    ]);
    const executionEvents = [event("execution_finished", { attemptId: undefined, executionId: "blocked-run", phase: "check", outcome: "blocked" })];
    const blocked = { ...run, phase: "syncing" as const, overallLabel: "预检失败", terminalAt: 2000 };
    const initial = activeBetRunComparison(blocked, events, [], executionEvents)[0]!;
    expect(initial.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.label)).toEqual(["预检通过", "预检失败"]);
    expect(initial.rows.find(row => row.id === "submission")?.cells.map(cell => cell.label)).toEqual(["未提交", "未提交"]);
    expect(initial.rows.find(row => row.id === "confirmation")?.cells.map(cell => cell.label)).toEqual(["未进入确认", "未进入确认"]);
    expect(initial.rows.find(row => row.id === "ray_monitor")?.cells[0]?.label).toBe("不参与");
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run: blocked, facts: events, executionEvents }) }));
    expect(html).toContain("整轮已拦截");
    expect(html).not.toContain("提交记录缺失");
    expect(html).not.toContain("等待确认");
    const another = activeBetRunComparison(blocked, events, [], [{ ...executionEvents[0]!, executionId: "another-run" }])[0]!;
    expect(another.rows.find(row => row.id === "submission")?.cells[0]?.label).toBe("提交记录缺失");
    events.get("A")!.push(event("submission_result", { executionId: "blocked-run", provider: "RAY", outcome: "accepted" }));
    const submitted = activeBetRunComparison(blocked, events, [], executionEvents)[0]!;
    expect(submitted.rows.find(row => row.id === "submission")?.cells[0]?.label).toBe("接口已受理");
  });
  it("shows each leg's precheck odds and preserves the snapshot across submission and makeup", async () => {
    const events = new Map<"A" | "B", OrderObservationEvent[]>([
      ["A", [event("precheck_result", { provider: "RAY", outcome: "prepared", odds: 1.85 }),
        event("submission_result", { provider: "RAY", outcome: "accepted", odds: 1.8 })]],
      ["B", [event("precheck_result", { provider: "Polymarket", outcome: "prepared", odds: 2.35 }),
        event("submission_result", { provider: "Polymarket", outcome: "accepted", odds: 2.3 }),
        event("precheck_result", { attemptId: "makeup-1", phase: "makeup", provider: "Polymarket", outcome: "prepared", odds: 2.25 })]],
    ]);
    const groups = activeBetRunComparison(run, events);
    expect(groups.find(group => group.key === "initial:1")?.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.odds)).toEqual([1.85, 2.35]);
    expect(groups.find(group => group.key === "makeup:1")?.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.odds)).toEqual([undefined, 2.25]);
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts: events }) }));
    const prechecks = [...html.matchAll(/<tr data-stage="precheck">([\s\S]*?)<\/tr>/g)].map(match => match[1]!);
    expect(prechecks[0]).toMatch(/data-side="A"[\s\S]*?预检赔率 @1\.85/);
    expect(prechecks[0]).toMatch(/data-side="B"[\s\S]*?预检赔率 @2\.35/);
    expect(prechecks[1]).toContain("预检赔率 @2.25");
    expect(prechecks[1]).not.toContain("预检赔率 @1.85");
    expect(html).not.toContain("预检赔率 @1.8<");
    expect(html).not.toContain("预检赔率 @2.3<");
  });
  it("keeps both initial prechecks on one row and isolates a one-leg makeup attempt", async () => {
    const groups = activeBetRunComparison(run, facts());
    const initial = groups.find(group => group.key === "initial:1")!;
    expect(initial.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.label)).toEqual(["预检通过", "预检通过"]);
    expect(initial.rows.find(row => row.id === "confirmation")?.cells.map(cell => cell.label)).toEqual(["拒单检测通过 · 未拒单", "超时策略处理"]);
    const makeup = groups.find(group => group.key === "makeup:1")!;
    expect(makeup.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.label)).toEqual(["本腿无此轮尝试", "预检失败"]);
    expect(makeup.rows.find(row => row.id === "submission")?.cells.map(cell => cell.label)).toEqual(["本腿无此轮尝试", "未提交"]);
    const html = await renderToString(createSSRApp({ render: () => h(OrderProgressComparison, { run, facts: facts() }) }));
    expect(html).toContain('aria-label="双腿各阶段结果对照"');
    const firstPrecheck = html.match(/<tr data-stage="precheck">([\s\S]*?)<\/tr>/)![1]!;
    expect(firstPrecheck.match(/预检通过/g)).toHaveLength(2);
    expect(firstPrecheck).toContain('data-side="A"');
    expect(firstPrecheck).toContain('data-side="B"');
    expect(html).toContain("1496ms");
    expect(html).toContain("卖价 0.32，限价 0.303");
  });
  it("keeps PM direct fill on the same confirmation row as the other leg's rejection check", () => {
    const events = facts();
    events.set("B", [event("submission_result", { provider: "Polymarket", outcome: "accepted", observedStatus: "matched" })]);
    const row = activeBetRunComparison(run, events)[0]!.rows.find(row => row.id === "confirmation")!;
    expect(row.cells.map(cell => cell.label)).toEqual(["拒单检测通过 · 未拒单", "直接成交 · 无需拒单检测"]);
    expect(row.cells[1]?.tone).toBe("success");
  });
  it("retains alignment for missing records, 9999 precheck-only and a non-RAY counterpart", () => {
    const legacy: ActiveBetRun = { ...run, phase: "checking", legs: [
      { ...run.legs[0]!, status: "pending", platform: "OB" },
      { ...run.legs[1]!, precheckOnly: true, status: "pending" },
    ] };
    const current = activeBetRunComparison(legacy, new Map())[0]!;
    expect(current.rows.find(row => row.id === "precheck")?.cells.map(cell => cell.label)).toEqual(["等待预检", "等待预检"]);
    expect(current.rows.find(row => row.id === "submission")?.cells[1]?.label).toBe("仅预检 · 不下单");
    expect(current.rows.find(row => row.id === "ray_monitor")).toBeUndefined();
  });
  it("does not pair attempts of unknown types across legs or pair different retry numbers", () => {
    const events = new Map<"A" | "B", OrderObservationEvent[]>([
      ["A", [event("precheck_result", { phase: undefined })]],
      ["B", [event("precheck_result", { phase: undefined })]],
    ]);
    const unknown = activeBetRunComparison(run, events).filter(group => group.key.startsWith("unknown"));
    expect(unknown).toHaveLength(2);
    expect(unknown[0]?.rows[0]?.cells[1]?.label).toBe("本腿无此轮尝试");
    expect(unknown[1]?.rows[0]?.cells[0]?.label).toBe("本腿无此轮尝试");
    events.set("A", [event("precheck_result", { phase: "retry", attemptId: "a-r1" })]);
    events.set("B", [event("precheck_result", { phase: "retry", attemptId: "b-r1" }), event("precheck_result", { phase: "retry", attemptId: "b-r2" })]);
    const retry = activeBetRunComparison(run, events).find(group => group.key === "retry:2")!;
    expect(retry.rows[0]?.cells[0]?.label).toBe("本腿无此轮尝试");
    events.set("B", [event("precheck_result", { phase: "retry", attemptId: "b-r3", retryRound: 3 })]);
    const recorded = activeBetRunComparison(run, events).find(group => group.key === "retry:3")!;
    expect(recorded.label).toBe("即时重试第 3 次");
    expect(recorded.rows[0]?.cells[0]?.label).toBe("本腿无此轮尝试");
  });
});
