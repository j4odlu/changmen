import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import type { AdminOrderLogLookup } from "@/types/admin";
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { progressPrecheck, progressSubmission, progressBinding, delayedPmConfirmation } from "@changmen/shared/order_progress_evidence";
import AdminOrderExecutionRecords from "@/components/admin/AdminOrderExecutionRecords.vue";
import { adminObservationAttempts, adminObservationIssues, adminObservationReport, hasDirectAdminDiagnosis } from "./adminOrderObservation";

function payload(): AdminOrderLogLookup {
  const base: OrderObservationEvent = { version: 1, ownerUserId: "u1", eventId: "check-123", kind: "precheck_result", occurredAt: 1000,
    sequence: 1, linkId: 123, executionId: "exec-123", attemptId: "attempt-123", provider: "Polymarket", accountId: 7,
    target: "Away", outcome: "prepared", odds: 1.9, amount: 10, currency: "USDC", durationMs: 0, source: "adapter_result" };
  const submit: OrderObservationEvent = { ...base, eventId: "submit-123", kind: "submission_result", sequence: 2, occurredAt: 2000,
    orderId: "pm-original", outcome: "accepted", observedStatus: "delayed", httpStatus: 200, responseCode: "ok", safeSummary: "接口受理尚不证明成交" };
  const bind: OrderObservationEvent = { ...submit, eventId: "bind-123", kind: "bind_result", sequence: 3, occurredAt: 3000, outcome: "saved", source: "bind_api_ack" };
  const events = [base, submit, bind];
  return { user: { id: "u1", userName: "test" }, anchor: { type: "link", value: 123 }, link: 123, linkType: "hash", groupLabel: "执行记录诊断",
    diagnosticSource: "events", legacyLogsLoaded: false, ordersQueried: true, logWindow: { fromMs: 1000, toMs: 3000 }, logs: [],
    orders: [{ orderId: "pm-original", link: 123, provider: "Polymarket", playerId: 7, match: "A vs B", bet: "获胜", item: "B",
      odds: 1.9, betMoney: 100, money: 0, status: "Pending", createAt: 2000 }],
    observation: { status: "available", mode: "shadow", truncated: false, events, issues: [], queues: [], attempts: [{ attemptId: "attempt-123", events,
      findings: ["缺少场馆确认事件"], evidence: "client_reported", confirmation: delayedPmConfirmation(events),
      progress: { precheck: progressPrecheck(events), submission: progressSubmission(events), binding: progressBinding(events) } }] } };
}

describe("管理后台直接执行诊断", () => {
  it("shows each phase with its own price, receipt and account rather than borrowing adjacent records", () => {
    const data = payload();
    data.orders.push({ ...data.orders[0]!, playerId: 8 });
    const attempt = adminObservationAttempts(data)[0]!;
    expect(attempt.stages[0]?.events[0]?.odds).toBe(1.9);
    expect(attempt.stages[1]?.label).toBe("delayed · 已受理待检测");
    expect(attempt.stages[3]?.label).toBe("订单待确认");
    expect(attempt.orders.map(order => order.playerId)).toEqual([7]);
  });
  it("a repeated precheck without a new result does not reuse the older odds", () => {
    const data = payload();
    const attempt = data.observation!.attempts[0]!;
    attempt.events.push({ ...attempt.events[0]!, eventId: "check-start-456", kind: "precheck_started", sequence: 4, odds: undefined });
    attempt.progress!.precheck = progressPrecheck(attempt.events);
    const stage = adminObservationAttempts(data)[0]!.stages[0]!;
    expect(stage.label).toBe("正在预检");
    expect(stage.events[0]?.odds).toBeUndefined();
  });
  it("retains explicit gap warnings and distinguishes direct data from unavailable observations", () => {
    const data = payload();
    expect(hasDirectAdminDiagnosis(data)).toBe(true);
    data.observation!.issues.push("客户端报告观察事件丢失");
    expect(adminObservationIssues(data)).toEqual(["客户端报告观察事件丢失", "缺少场馆确认事件"]);
    data.observation!.status = "unavailable";
    expect(hasDirectAdminDiagnosis(data)).toBe(false);
  });
  it("uses the legacy fallback when only transport loss metadata is present and keeps its warnings", () => {
    const data = payload();
    data.observation!.events = [{ ...data.observation!.events[0]!, kind: "transport_gap" }];
    data.observation!.attempts = [];
    data.observation!.issues = ["客户端报告观察事件丢失"];
    data.observation!.truncated = true;
    data.logStats = { total: 1000, related: 10, unrelated: 990, truncated: true, limit: 1000 };
    expect(hasDirectAdminDiagnosis(data)).toBe(false);
    expect(adminObservationIssues(data)).toEqual(["客户端报告观察事件丢失", "旁路事件已截断", "旧日志已截断，可能缺少后续记录"]);
  });
  it("the full admin view displays currencies, zero duration, IDs, status and reasons while escaping text", async () => {
    const data = payload();
    data.observation!.attempts[0]!.events[1]!.safeSummary = "<script>unsafe</script>";
    const html = await renderToString(createSSRApp(AdminOrderExecutionRecords, { data }));
    for (const expected of ["预检赔率 @1.9", "10 USDC", "耗时 0ms", "HTTP 200", "pm-original", "exec-123", "attempt-123", "Pending", "订单待确认", "&lt;script&gt;unsafe&lt;/script&gt;"])
      expect(html).toContain(expected);
    expect(html).not.toContain("查看依据");
    expect(html).not.toContain("<script>unsafe</script>");
  });
  it("copies a direct diagnostic report without inventing a complete execution or omitting the unknown state", () => {
    const data = payload();
    data.observation!.events.push({ ...data.observation!.events[0]!, eventId: "queue-123", kind: "queue_created",
      attemptId: undefined, queueId: "retry-queue-123", anchorOrderId: "pm-original", anchorAttemptId: "attempt-123", outcome: "queued" });
    const report = adminObservationReport(data);
    expect(report).toContain("旧日志未查询");
    expect(report).toContain("订单待确认");
    expect(report).toContain("USDC");
    expect(report).toContain("缺少场馆确认事件");
    expect(report).toContain("队列 retry-queue-123");
    expect(report).toContain("锚订单 pm-original");
    expect(report).toContain("HTTP 200");
    expect(report).toContain("耗时 0ms");
    expect(report).not.toContain("覆盖完整");
  });
});
