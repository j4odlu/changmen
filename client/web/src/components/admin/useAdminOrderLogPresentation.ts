import { computed, type Ref } from "vue";
import type { AdminOrderLogEntry, AdminOrderLogLookup } from "@/types/admin";
import { orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { adminObservationIssues, hasDirectAdminDiagnosis } from "@/shared/adminOrderObservation";
import {
  adminOrderEvidenceIssues, buildAdminOrderDiagnosisSummary, buildAdminOrderExecutionSteps,
  buildAdminOrderOrchestrationStages, filterAdminOrderDiagnosisLogs,
} from "@/shared/adminOrderDiagnosis";
import { filterBackendLegSections } from "@/shared/adminOrderLogSegments";
import { sumAdminOrdersMoneyCny } from "@/shared/adminOrderMoney";
import { fallbackLegSections } from "./adminOrderLogGrouping";

/** [changmen 扩展] 仅计算当前诊断的展示数据；查询和弹窗生命周期由组件持有。 */
export function useAdminOrderLogPresentation(
  data: Ref<AdminOrderLogLookup | null>,
  readExecutionLookup: () => { userId: string } | null,
) {
  const observationTimeline = computed(() => orderObservationTimeline(data.value?.observation?.events || []));

  const directDiagnosis = computed(() => hasDirectAdminDiagnosis(data.value));

  const frontendLogFilter = computed(() => {
    if (!data.value)
      return { related: [] as AdminOrderLogEntry[], filtered: [] as AdminOrderLogEntry[] };
    return filterAdminOrderDiagnosisLogs(data.value);
  });

  const filteredLogs = computed(() => {
    const merged = [
      ...frontendLogFilter.value.filtered,
      ...(data.value?.unrelatedLogs ?? []),
    ];
    const seen = new Set<string>();
    return merged.filter((log) => {
      const key = String(log.id ?? `${log.createAt}:${log.title}:${log.summary}`);
      if (seen.has(key))
        return false;
      seen.add(key);
      return true;
    });
  });

  const legColumns = computed(() => {
    if (!data.value)
      return [];
    // 新后端已按 linkId/orderId/时序完成精确关联；前端只做安全过滤，避免把
    // 没有 target 的下注结果重新猜到另一条腿。旧后端无 legSections 才兜底重建。
    const backendLegs = filterBackendLegSections(
      data.value.legSections,
      frontendLogFilter.value.related,
    );
    if (backendLegs)
      return backendLegs;
    return fallbackLegSections({
      ...data.value,
      logs: frontendLogFilter.value.related,
    });
  });

  const dialogWidth = computed(() => {
    const n = legColumns.value.length;
    if (n <= 2)
      return "min(1040px, 96vw)";
    return `min(${720 + n * 240}px, 98vw)`;
  });

  const legColumnsStyle = computed(() => ({
    "--order-log-cols": String(Math.max(legColumns.value.length, 1)),
  }));

  const sortedOrders = computed(() => {
    if (!data.value?.orders.length)
      return [];
    return [...data.value.orders].sort((a, b) => a.createAt - b.createAt);
  });

  const overviewMatch = computed(() => {
    const matches = sortedOrders.value.map(o => o.match).filter(Boolean);
    if (!matches.length)
      return "";
    const first = matches[0];
    return matches.every(m => m === first) ? first : matches[0];
  });

  const totalProfit = computed(() =>
    sumAdminOrdersMoneyCny(sortedOrders.value),
  );

  const executionSteps = computed(() => buildAdminOrderExecutionSteps(legColumns.value));

  const diagnosisContext = computed(() => ({ linkType: data.value?.linkType, truncated: data.value?.logStats?.truncated }));

  const evidenceIssues = computed(() => [...new Set([
    ...adminObservationIssues(data.value),
    ...(!directDiagnosis.value ? adminOrderEvidenceIssues(executionSteps.value, diagnosisContext.value) : []),
  ])]);

  const suggestedCheck = computed(() => {
    if (directDiagnosis.value)
      return "逐笔核对预检、提交、绑定与场馆确认；缺口和超时策略不能代表官方未成交。需要历史文字记录时可补查旧日志。";
    if (readExecutionLookup() && !data.value?.orders.length)
      return "核查执行时间线中的失败、确认、绑定及缺口事件；缺少落库证据不能证明未成交。";
    if (data.value?.logStats?.truncated)
      return "扩大日志查询后重新诊断；当前日志已截断，后续动作可能缺失。";
    if (evidenceIssues.value.length)
      return "核对场馆订单状态，并补查缺失日志；当前证据不足以确认完整执行结果。";
    if (executionSteps.value.some(step => step.bet?.success === false || step.rejectLogic || step.check?.checkError))
      return "核对失败或拒单原因，以及重试、补单后的场馆订单，确认是否仍存在单腿敞口。";
    return "现有证据已覆盖执行过程；比赛未结算前，盈亏以当前记录为准。";
  });

  const diagnosisSummary = computed(() => directDiagnosis.value
    ? { text: `已读取 ${data.value?.observation?.events.length || 0} 条直接执行记录、${data.value?.observation?.attempts.length || 0} 次尝试；每笔状态分别展示。`, tone: "warning" as const }
    : readExecutionLookup() && !data.value?.orders.length
    ? { text: "当前显示执行观察记录；成交与落库状态请核查确认和绑定事件。", tone: "warning" as const }
    : buildAdminOrderDiagnosisSummary(executionSteps.value, totalProfit.value, diagnosisContext.value));

  const orchestrationStages = computed(() =>
    buildAdminOrderOrchestrationStages(executionSteps.value, totalProfit.value, diagnosisContext.value),
  );

  const orchestrationStartAt = computed(() => orchestrationStages.value[0]?.at || 0);

  const platformLabels = computed(() => {
    const labels = new Set<string>();
    for (const o of sortedOrders.value) {
      if (o.provider)
        labels.add(o.provider);
    }
    for (const event of data.value?.observation?.events || []) {
      if (event.provider) labels.add(event.provider);
    }
    return [...labels].join(" · ");
  });

  const logStats = computed(() => ({
    total: data.value?.logStats?.total ?? (frontendLogFilter.value.related.length + filteredLogs.value.length),
    related: frontendLogFilter.value.related.length,
    unrelated: filteredLogs.value.length,
    truncated: data.value?.logStats?.truncated ?? false,
    limit: data.value?.logStats?.limit ?? 0,
  }));

  const hasOverviewOrders = computed(() => sortedOrders.value.length > 0);

  function fmtOrchestrationElapsed(at: number) {
    const ms = Math.max(0, Number(at) - orchestrationStartAt.value);
    if (ms < 1_000)
      return `+${Math.round(ms)}ms`;
    return `+${Number((ms / 1_000).toFixed(1))}s`;
  }

  return {
    observationTimeline, directDiagnosis, frontendLogFilter, filteredLogs,
    legColumns, dialogWidth, legColumnsStyle, sortedOrders, overviewMatch,
    totalProfit, executionSteps, diagnosisContext, evidenceIssues, suggestedCheck,
    diagnosisSummary, orchestrationStages, orchestrationStartAt, platformLabels,
    logStats, hasOverviewOrders, fmtOrchestrationElapsed,
  };
}
