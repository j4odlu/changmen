import type { AdminOrderLogLegSection } from "@/types/admin";
import { describe, expect, it } from "vitest";
import {
  adminOrderEvidenceIssues,
  buildAdminOrderDiagnosisSummary,
  buildAdminOrderExecutionSteps,
  buildAdminOrderOrchestrationStages,
  filterAdminOrderDiagnosisLogs,
} from "@/shared/adminOrderDiagnosis";

describe("adminOrderDiagnosis", () => {
  function pendingLeg(side: "Home" | "Away", status = "Pending"): AdminOrderLogLegSection {
    return {
      key: side,
      legIndex: side === "Home" ? 0 : 1,
      side,
      label: side,
      provider: "OB",
      attempts: [{
        key: side,
        order: { orderId: side, link: 1, provider: "OB", playerId: 1, match: "m", bet: "b", item: side, odds: 2, betMoney: 100, money: 0, status, createAt: 100 },
        logs: [
          { createAt: 100, title: "", kind: "check", target: side, provider: "OB", odds: 2, betMoney: 100, summary: "check" },
          { createAt: 110, title: "", kind: "bet", orderId: side, provider: "OB", success: true, summary: "accepted" },
        ],
      }],
    };
  }

  it.each(["Pending", "None", "unknown"])("does not confirm a %s order as filled", (status) => {
    const steps = buildAdminOrderExecutionSteps([pendingLeg("Home", status), pendingLeg("Away", status)]);
    const stage = buildAdminOrderOrchestrationStages(steps, 0).find(stage => stage.key === "settle");
    expect(stage?.decision).toContain("0 腿确认成交");
    expect(stage?.decision).toContain("2 腿仍待确认");
    expect(stage?.tone).toBe("warning");
    expect(buildAdminOrderDiagnosisSummary(steps, 0).text).toContain("当前已记录");
  });

  it("does not invent a second accepted leg from one successful request", () => {
    const steps = buildAdminOrderExecutionSteps([pendingLeg("Home", "Win")]);
    const summary = buildAdminOrderDiagnosisSummary(steps, 100);
    expect(summary.tone).toBe("warning");
    expect(summary.text).toContain("初始双腿证据不足");
    expect(buildAdminOrderOrchestrationStages(steps, 100).find(stage => stage.key === "place")?.decision).not.toContain("两腿接口均已受理");
  });

  it("uses single-leg wording for single-sided orders and downgrades truncated evidence", () => {
    const steps = buildAdminOrderExecutionSteps([pendingLeg("Home", "Win")]);
    expect(buildAdminOrderDiagnosisSummary(steps, 100, { linkType: "单边" }).text).toContain("单边订单");
    expect(adminOrderEvidenceIssues(steps, { linkType: "单边" })).toEqual([]);
    const summary = buildAdminOrderDiagnosisSummary(steps, 100, { linkType: "单边", truncated: true });
    expect(summary.tone).toBe("warning");
    expect(summary.text).toContain("日志已截断");
    expect(summary.text).not.toContain("最终 Link 盈亏");
  });

  it("keeps returned orders separate from confirmed fills", () => {
    const steps = buildAdminOrderExecutionSteps([pendingLeg("Home", "Return"), pendingLeg("Away", "Win")]);
    const stage = buildAdminOrderOrchestrationStages(steps, 0).find(stage => stage.key === "settle");
    expect(stage?.decision).toContain("1 腿确认成交");
    expect(stage?.decision).toContain("1 腿已退回");
  });

  it("reports failed prechecks even without a bet submission", () => {
    const legs = [pendingLeg("Home"), pendingLeg("Away")];
    for (const leg of legs) {
      leg.attempts[0]!.order = null;
      leg.attempts[0]!.logs = [{ createAt: 100, title: "", kind: "check", target: leg.side, provider: "OB", checkError: "盘口关闭", summary: "blocked" }];
    }
    const summary = buildAdminOrderDiagnosisSummary(buildAdminOrderExecutionSteps(legs), 0);
    expect(summary.text).toContain("2 腿预检失败");
    expect(summary.tone).toBe("danger");
  });

  it("does not mark a different-side queue canceled just because counts match", () => {
    const steps = buildAdminOrderExecutionSteps([{
      key: "queue",
      legIndex: 0,
      side: "Home",
      label: "主队",
      provider: null,
      attempts: [{ key: "queue", order: null, logs: [{ createAt: 100, title: "", kind: "makeup_queue", target: "Home", summary: "queued" }] }],
    }, {
      key: "cancel",
      legIndex: 1,
      side: "Away",
      label: "客队",
      provider: null,
      attempts: [{ key: "cancel", order: null, logs: [{ createAt: 200, title: "", kind: "makeup_cancel", target: "Away", summary: "canceled" }] }],
    }]);
    expect(buildAdminOrderOrchestrationStages(steps, 0).find(stage => stage.key === "queue")?.tone).toBe("warning");
  });
  it("keeps exact Link logs and only near-order legacy logs", () => {
    const link = 1_790_266_881_397;
    const order = {
      orderId: "current",
      link,
      provider: "Polymarket",
      playerId: 1,
      match: "m",
      bet: "b",
      item: "home",
      odds: 2.272,
      betMoney: 9.06,
      money: -63,
      status: "Lose",
      createAt: link,
    };
    const logs = [
      { id: 1, createAt: link - 180_000, title: "", kind: "check", match: "m", summary: "同场较早轮次" },
      { id: 2, createAt: link + 2_000, title: "", kind: "check", match: "m", summary: "当前旧日志" },
      { id: 3, createAt: link + 900_000, title: "", kind: "reject", linkId: link, summary: "当前 Link 延迟15分钟拒单" },
      { id: 4, createAt: link + 1_000, title: "", kind: "check", linkId: link + 1, summary: "另一 Link" },
      { id: 5, createAt: link + 1_000, title: "", kind: "bet", linkId: link + 1, orderId: "current", summary: "冲突的明确 Link" },
    ];

    const result = filterAdminOrderDiagnosisLogs({ link, orders: [order], logs });
    expect(result.related.map(log => log.id)).toEqual([2, 3]);
    expect(result.filtered.map(log => log.id)).toEqual([1, 4, 5]);
  });

  it("renders failed PM, accepted-then-rejected RAY, and makeup in true time order", () => {
    const legs: AdminOrderLogLegSection[] = [
      {
        key: "home",
        legIndex: 0,
        side: "Home",
        label: "主队",
        provider: "Polymarket/RAY",
        attempts: [
          {
            key: "pm-fail",
            order: null,
            logs: [],
            logSegments: [{
              key: "pm",
              provider: "Polymarket",
              accountLabel: "PM / a",
              isMakeUp: false,
              logs: [
                { createAt: 100, title: "", kind: "check", provider: "Polymarket", target: "Home", odds: 2.272, betMoney: 38.21, planBetMoney: 256.16, stakeExchange: 6.7, stakeRate: 1, summary: "check" },
                { createAt: 120, title: "", kind: "bet", provider: "Polymarket", success: false, message: "FOK 深度不足", summary: "fail" },
              ],
            }],
          },
          {
            key: "ray-makeup",
            order: { orderId: "m1", link: 1, provider: "RAY", playerId: 1, match: "m", bet: "b", item: "Apogee", odds: 1.86, betMoney: 313, money: -313, status: "Lose", createAt: 400 },
            logs: [],
            logSegments: [{
              key: "makeup",
              provider: "RAY",
              accountLabel: "RAY / a",
              isMakeUp: true,
              logs: [
                { createAt: 400, title: "", kind: "check", provider: "RAY", target: "Home", odds: 1.86, betMoney: 313, loseOrder: true, summary: "check" },
                { createAt: 410, title: "", kind: "bet", provider: "RAY", success: true, summary: "ok" },
              ],
            }],
          },
        ],
      },
      {
        key: "away",
        legIndex: 1,
        side: "Away",
        label: "客队",
        provider: "RAY",
        attempts: [{
          key: "ray-away",
          order: { orderId: "r1", link: 1, provider: "RAY", playerId: 1, match: "m", bet: "b", item: "ASTRAL", odds: 1.94, betMoney: 300, money: 0, status: "Reject", createAt: 110 },
          logs: [],
          logSegments: [{
            key: "ray",
            provider: "RAY",
            accountLabel: "RAY / a",
            isMakeUp: false,
            logs: [
              { createAt: 110, title: "", kind: "check", provider: "RAY", target: "Away", odds: 1.94, betMoney: 300, summary: "check" },
              { createAt: 130, title: "", kind: "bet", provider: "RAY", success: true, summary: "ok" },
            ],
          }],
        }],
      },
    ];

    const steps = buildAdminOrderExecutionSteps(legs);
    expect(steps.map(step => step.provider)).toEqual(["Polymarket", "RAY", "RAY"]);
    expect(steps.map(step => step.outcome)).toEqual([
      "下单失败",
      "接口受理 → 场馆拒单",
      "接口受理 → 已结算：输",
    ]);
    expect(steps[2].isMakeUp).toBe(true);
    expect(steps[0].rejectLogic).toContain("即时失败");
    expect(steps[0].rejectLogic).toContain("20ms");
    expect(steps[0].stakeLogic).toContain("计划金额 ¥256.16");
    expect(steps[1].rejectLogic).toContain("事后拒单");
    expect(steps[1].rejectLogic).toContain("无法计算间隔");
    expect(steps[2].oddsLogic).toContain("场馆实时盘口");
    expect(steps[2].stakeLogic).toContain("300 × 1.94 ÷ 实时赔率 1.86");
    expect(buildAdminOrderDiagnosisSummary(steps, -313)).toEqual({
      text: "首轮套利执行未完整成交：1 腿下单失败，1 笔场馆拒单；实际提交 1 次补单；最终 Link 盈亏 ¥-313；拒单发现时间缺失",
      tone: "danger",
    });
    const stages = buildAdminOrderOrchestrationStages(steps, -313);
    expect(stages.map(stage => stage.title)).toEqual([
      "生成对冲方案",
      "双腿预检",
      "首轮下单",
      "场馆终态确认",
      "补单执行",
      "编排收尾",
    ]);
    expect(stages.find(stage => stage.key === "place")?.decision).toContain("单腿敞口");
    expect(stages.find(stage => stage.key === "makeup")?.action).toContain("实时赔率");
    expect(stages.find(stage => stage.key === "plan")?.homeNodes).toHaveLength(1);
    expect(stages.find(stage => stage.key === "plan")?.awayNodes).toHaveLength(1);
    expect(stages.find(stage => stage.key === "place")?.homeNodes[0]?.title).toBe("下单失败");
    expect(stages.find(stage => stage.key === "place")?.awayNodes[0]?.title).toBe("接口受理");
  });

  it("uses structured settlement logs for exact post-accept reject delay and reason", () => {
    const legs: AdminOrderLogLegSection[] = [{
      key: "away",
      legIndex: 1,
      side: "Away",
      label: "客队",
      provider: "RAY",
      attempts: [{
        key: "ray-away",
        order: null,
        logs: [],
        logSegments: [{
          key: "ray",
          provider: "RAY",
          accountLabel: "RAY / a",
          isMakeUp: false,
          logs: [
            { createAt: 1_000, title: "", kind: "check", provider: "RAY", target: "Away", odds: 1.78, betMoney: 70, summary: "check" },
            { createAt: 1_100, title: "", kind: "bet", provider: "RAY", success: true, summary: "ok" },
            { createAt: 31_000, title: "", kind: "reject", provider: "RAY", target: "Away", settlement: "unfilled", rejectDelayMs: 30_000, rejectReason: "额度不足", summary: "reject" },
          ],
        }],
      }],
    }];

    const [step] = buildAdminOrderExecutionSteps(legs);
    expect(step?.outcome).toBe("接口受理 → 场馆拒单");
    expect(step?.rejectLogic).toContain("间隔 30秒");
    expect(step?.rejectLogic).toContain("额度不足");
  });

  it("does not attach a later makeup order terminal status to an earlier failed attempt", () => {
    const order = { orderId: "ob-makeup", link: 1, provider: "OB", playerId: 1, match: "m", bet: "b", item: "TYLOO", odds: 3.015, betMoney: 41, money: -41, status: "Lose", createAt: 78_000 };
    const legs: AdminOrderLogLegSection[] = [{
      key: "home",
      legIndex: 0,
      side: "Home",
      label: "主队",
      provider: "OB",
      attempts: [{
        key: "ob-makeup",
        order,
        logs: [],
        logSegments: [
          {
            key: "initial-fail",
            provider: "OB",
            accountLabel: "OB / a",
            isMakeUp: false,
            logs: [
              { createAt: 100, title: "", kind: "check", provider: "OB", target: "Home", odds: 2.518, betMoney: 49, summary: "check" },
              { createAt: 200, title: "", kind: "bet", provider: "OB", success: false, message: "赔率错误", summary: "fail" },
            ],
          },
          {
            key: "makeup",
            provider: "OB",
            accountLabel: "OB / a",
            isMakeUp: true,
            logs: [
              { createAt: 78_000, title: "", kind: "check", provider: "OB", target: "Home", odds: 3.015, betMoney: 41, loseOrder: true, summary: "check" },
              { createAt: 78_100, title: "", kind: "bet", provider: "OB", success: true, summary: "ok" },
            ],
          },
        ],
      }],
    }];

    const steps = buildAdminOrderExecutionSteps(legs);
    expect(steps[0].order).toBeNull();
    expect(steps[0].outcome).toBe("下单失败");
    expect(steps[1].order?.orderId).toBe("ob-makeup");
    expect(steps[1].outcome).toBe("接口受理 → 已结算：输");
  });

  it("labels a historical failed-leg recheck as immediate retry", () => {
    const legs: AdminOrderLogLegSection[] = [
      {
        key: "home",
        legIndex: 0,
        side: "Home",
        label: "主队",
        provider: "Polymarket",
        attempts: [{
          key: "pm",
          order: { orderId: "pm1", link: 1, provider: "Polymarket", playerId: 1, match: "m", bet: "b", item: "Phantom", odds: 2.702, betMoney: 20.9, money: -145, status: "Lose", createAt: 1_000 },
          logs: [],
          logSegments: [{
            key: "pm",
            provider: "Polymarket",
            accountLabel: "PM / a",
            isMakeUp: false,
            logs: [
              { createAt: 900, title: "", kind: "check", provider: "Polymarket", target: "Home", odds: 2.702, betMoney: 20.9, planBetMoney: 140, summary: "check" },
              { createAt: 1_000, title: "", kind: "bet", provider: "Polymarket", success: true, summary: "ok" },
              { createAt: 12_000, observedAt: 12_000, title: "", kind: "reject", provider: "Polymarket", settlement: "filled", summary: "filled" },
            ],
          }],
        }],
      },
      {
        key: "away",
        legIndex: 1,
        side: "Away",
        label: "客队",
        provider: "RAY",
        attempts: [{
          key: "ray",
          order: null,
          logs: [],
          logSegments: [
            {
              key: "initial",
              provider: "RAY",
              accountLabel: "RAY / a",
              isMakeUp: false,
              logs: [
                { createAt: 880, title: "", kind: "check", provider: "RAY", target: "Away", odds: 1.76, betMoney: 200, summary: "check" },
                { createAt: 1_100, title: "", kind: "bet", provider: "RAY", success: false, message: "已封盘", summary: "fail" },
              ],
            },
            {
              key: "retry",
              provider: "RAY",
              accountLabel: "RAY / a",
              isMakeUp: false,
              logs: [
                { createAt: 1_200, title: "", kind: "check", provider: "RAY", target: "Away", odds: 1.76, betMoney: 214, checkError: "已封盘", summary: "retry" },
              ],
            },
          ],
        }],
      },
    ];

    const steps = buildAdminOrderExecutionSteps(legs);
    const retry = steps.find(step => step.isRetry);
    expect(retry?.outcome).toBe("预检失败");
    expect(retry?.oddsLogic).toContain("再次预检");
    expect(retry?.stakeLogic).toContain("140 × 2.702 ÷ 实时赔率 1.76");
    expect(buildAdminOrderDiagnosisSummary(steps, -145).text).toContain("即时重试 1 次");
    const stages = buildAdminOrderOrchestrationStages(steps, -145);
    expect(stages.find(stage => stage.key === "retry")?.decision).toContain("失败方向");
    expect(stages.find(stage => stage.key === "retry")?.action).toContain("补单判断");
    expect(stages.findIndex(stage => stage.key === "retry")).toBeLessThan(
      stages.findIndex(stage => stage.key === "settle"),
    );
  });

  it("shows queue creation separately from an executed makeup", () => {
    const legs: AdminOrderLogLegSection[] = [{
      key: "away",
      legIndex: 1,
      side: "Away",
      label: "客队",
      provider: "系统",
      attempts: [{
        key: "queue",
        order: null,
        logs: [],
        logSegments: [{
          key: "queue",
          provider: null,
          accountLabel: null,
          isMakeUp: false,
          logs: [{ createAt: 2_000, title: "补单入队", kind: "makeup_queue", attemptType: "makeup_queue", target: "Away", betMoney: 140, odds: 2.702, failedLegOdds: 1.76, summary: "queue" }],
        }],
      }],
    }];

    const [queue] = buildAdminOrderExecutionSteps(legs);
    expect(queue?.isQueue).toBe(true);
    expect(queue?.isMakeUp).toBe(false);
    expect(queue?.outcome).toContain("尚未下单");
    expect(queue?.stakeLogic).toContain("真正执行时");
    const stages = buildAdminOrderOrchestrationStages([queue!], 0);
    expect(stages.find(stage => stage.key === "queue")?.action).toContain("只代表进入补单队列");
  });

  it("shows a rejected anchor canceling the queued makeup before submission", () => {
    const legs: AdminOrderLogLegSection[] = [{
      key: "away",
      legIndex: 1,
      side: "Away",
      label: "客队",
      provider: "系统",
      attempts: [{
        key: "queue-events",
        order: null,
        logs: [],
        logSegments: [
          {
            key: "queue",
            provider: null,
            accountLabel: null,
            isMakeUp: false,
            logs: [{ createAt: 2_000, title: "补单入队", kind: "makeup_queue", attemptType: "makeup_queue", target: "Away", summary: "queue" }],
          },
          {
            key: "cancel",
            provider: null,
            accountLabel: null,
            isMakeUp: false,
            logs: [{ createAt: 2_100, title: "补单取消", kind: "makeup_cancel", attemptType: "makeup_cancel", target: "Away", message: "RAY Home 确认拒单，已无有效成交锚点", summary: "cancel" }],
          },
        ],
      }],
    }];

    const steps = buildAdminOrderExecutionSteps(legs);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.isQueueCancel).toBe(true);
    expect(steps[1]?.outcome).toContain("未继续下单");
    expect(buildAdminOrderDiagnosisSummary(steps, -237).text).toContain("取消 1 个补单队列");
    const queueStage = buildAdminOrderOrchestrationStages(steps, -237).find(stage => stage.key === "queue");
    expect(queueStage?.tone).toBe("success");
    expect(queueStage?.action).toContain("没有继续向场馆提交补单");
    expect(queueStage?.awayNodes.map(node => node.title)).toEqual(["补单入队", "补单已取消"]);
  });

  it("flags a makeup that continues after its accepted anchor is later rejected", () => {
    const steps = [
      {
        key: "anchor",
        at: 100,
        side: "Home",
        sideLabel: "主队",
        provider: "RAY",
        isMakeUp: false,
        isRetry: false,
        isQueue: false,
        bet: { createAt: 110, success: true },
        reject: { createAt: 200, observedAt: 200, settlement: "unfilled" },
        order: { createAt: 110, status: "Reject" },
      },
      {
        key: "queue",
        at: 120,
        side: "Away",
        sideLabel: "客队",
        provider: "系统",
        isMakeUp: false,
        isRetry: false,
        isQueue: true,
        queue: { createAt: 120 },
      },
      {
        key: "makeup-check-only",
        at: 250,
        side: "Away",
        sideLabel: "客队",
        provider: "Polymarket",
        isMakeUp: true,
        isRetry: false,
        isQueue: false,
        check: { createAt: 250 },
      },
      {
        key: "makeup-placed",
        at: 300,
        side: "Away",
        sideLabel: "客队",
        provider: "RAY",
        isMakeUp: true,
        isRetry: false,
        isQueue: false,
        check: { createAt: 300 },
        bet: { createAt: 310, success: true },
        order: { createAt: 310, status: "Lose" },
      },
    ] as any;

    const summary = buildAdminOrderDiagnosisSummary(steps, -237);
    expect(summary.text).toContain("实际提交 1 次补单");
    expect(summary.text).toContain("1 次补单仅记录到预检");
    expect(summary.text).toContain("锚腿拒单后补单队列仍继续执行");
    const stages = buildAdminOrderOrchestrationStages(steps, -237);
    expect(stages.find(stage => stage.key === "queue")?.tone).toBe("danger");
    expect(stages.find(stage => stage.key === "queue")?.action).toContain("编排异常");
    expect(stages.find(stage => stage.key === "makeup")?.decision).toContain("实际提交 1 轮");
  });
});
