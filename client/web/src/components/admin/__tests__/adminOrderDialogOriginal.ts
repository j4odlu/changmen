import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import ts from "typescript";

export const originalAdminOrderDialog = execFileSync("git", ["show",
  "ea73dc5d2c65ccf2c320ddb9a852228fb15da269:client/web/src/components/admin/AdminOrderLogsDialog.vue"],
{ encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(originalAdminOrderDialog).digest("hex") !== "b90042b634262b186d575f86f293f4f0c983b8052b5c8f2f903c0115404f6b39")
  throw new Error("Original admin order dialog baseline changed");
export const originalAdminOrderScript = originalAdminOrderDialog.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
export const adminOrderDialogGroups = {
  adminOrderLogGrouping: ["isArbLookup", "assignOrphanLogs", "inferTargetFromLogs", "sideLabel", "attemptProvider", "touchLegProvider", "pickLegIndexForUnassigned", "resolveLegIndexByProvider", "fallbackLegSections"],
  adminOrderLogDisplay: ["fmtTime", "fmtClock", "fmtMoney", "orderMoneyCny", "orderStakeLabel", "orderStakeCny", "reduceEvents", "fmtMaybeNumber", "kindClass", "statusBadgeClass", "pnlClass", "logDetailParts", "attemptDividerLabel", "legOrderAttempts", "legProfit"],
  useAdminOrderLogPresentation: ["fmtOrchestrationElapsed"],
};
export const adminOrderComputedNames = ["observationTimeline", "directDiagnosis", "frontendLogFilter", "filteredLogs", "legColumns", "dialogWidth", "legColumnsStyle", "sortedOrders", "overviewMatch", "totalProfit", "executionSteps", "diagnosisContext", "evidenceIssues", "suggestedCheck", "diagnosisSummary", "orchestrationStages", "orchestrationStartAt", "platformLabels", "logStats", "hasOverviewOrders"];
export function executableAdminOrderSource(source: string) {
  return ts.transpileModule(source.replace(/^export /m, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}
