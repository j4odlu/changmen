// [changmen 扩展] 已提交的 RAY 监控迁移：固定完整实现，只还原公共收尾中的两处命名迁移。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { verifyRayClientMonitorSource } from "./ray-client-monitor-boundary.mjs";
import { readAdapterBrowserSource } from "./adapter-browser-relocation.mjs";
import { restoreRaySubmissionPreviewSource, verifyRaySubmissionPreviewSources } from "./ray-submission-preview-boundary.mjs";

export const rayFrontendCommit = "2391dc9df446dcb7ed85030a3faca3696b0d0da7";
export const rayFrontendSources = Object.freeze([
  "client/web/src/runtime/orderPolling/ray.ts",
  "server/backend/core/account/ray_monitor_orders.js",
  ...["api", "autoMakeup", "contextStore", "contexts", "lifecycle", "match", "runtime", "state", "types"].map(name => `client/web/src/runtime/rayOrderMonitor/${name}.ts`),
  "client/web/src/runtime/rayOrderMonitor/localOrders.ts",
  "client/web/src/stores/account/rayOrderBindings.ts",
  "client/web/src/orderModes/gtc/otherOrders.ts",
]);
export function verifyRayFrontendSources(readSource) {
  verifyRaySubmissionPreviewSources(readSource);
  for (const file of rayFrontendSources) {
    if (verifyRayClientMonitorSource(file, readSource(file)))
      continue;
    const original = execFileSync("git", ["show", `${rayFrontendCommit}:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    assert.equal(readSource(file).replaceAll("\r\n", "\n"), original, `${file}: complete committed RAY monitor source`);
  }
  return { reviewedCommit: rayFrontendCommit, completeModules: rayFrontendSources.length };
}
export function restoreRayFinalizeSource(file, source, replaceExact) {
  if (file !== "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts" || !source.includes("registerRayOrderContext"))
    return source;
  source = replaceExact(source, "import { registerRayOrderContext } from \"@/runtime/rayOrderMonitor/contexts\";", "import { registerRayRejectMonitor } from \"@/extensions/arbBet/rayRejectMonitor/runtime\";");
  return replaceExact(source, "registerRayOrderContext({", "registerRayRejectMonitor({");
}
export function restoreRayOrderViewSource(source) {
  source = restoreRaySubmissionPreviewSource("client/web/src/components/order/OrderView.vue", source);
  for (const [before, after] of [
    ["import { useRayOrderContextStore } from \"@/runtime/rayOrderMonitor/contextStore\";", "import { useRayRejectMonitorStore } from \"@/extensions/arbBet/rayRejectMonitor/store\";"],
    ["const rayOrderContextStore = useRayOrderContextStore();", "const rayRejectMonitorStore = useRayRejectMonitorStore();"],
    ["rayOrderContextStore.restore(String(userStore.userId));", "rayRejectMonitorStore.restore(String(userStore.userId));"],
    ["return rayOrderContextStore.taskForLink(link);", "return rayRejectMonitorStore.taskForLink(link);"],
  ]) {
    assert.equal(source.split(before).length, 2, `one exact RAY display migration: ${before}`);
    source = source.replace(before, after);
  }
  return source;
}
export function restoreRayProviderSource(file, source, readSource) {
  source = restoreRayMapOutcomeSource(file, source);
  if (file !== "client/web/src/runtime/providers.ts")
    return source;
  const commit = "adb333bf24b6ba6aa3e441009b56f874a23f6ed9";
  for (const [path, current] of [[file, source], ["client/web/src/runtime/orderMonitoring/rayOrders.ts", readSource("client/web/src/runtime/orderMonitoring/rayOrders.ts")]]) {
    const fixed = execFileSync("git", ["show", `${commit}:${path}`], { encoding: "utf8" });
    assert.equal(restoreRaySubmissionPreviewSource(path, current).replaceAll("\r\n", "\n"), fixed.replaceAll("\r\n", "\n"), `${path}: complete committed passive RAY observation`);
  }
  return "export { getProvider, supportedBetProviders } from \"@/runtime/venueAdapters\";\n";
}

/** [changmen 扩展] 精确还原赛果展示与原始字段透传；继续核对完整采集、赔率、下注实现。 */
export function restoreRayMapOutcomeSource(file, source) {
  source = readAdapterBrowserSource(file, source);
  source = source.replaceAll("\r\n", "\n");
  const resultChanges = {
    "packages/venue-adapter/shared/webBridgeTypes.ts": [
      ['    matchResult?: Record<string, unknown>,\n', ''],
    ],
    "packages/venue-adapter/ray/collect.ts": [
      ['const { bets, matchResult } = await loadRayBets(', 'const bets = await loadRayBets('],
      ['await collect.saveBets(PLATFORM, matchId, bets, matchResult);', 'await collect.saveBets(PLATFORM, matchId, bets);'],
    ],
    "packages/venue-adapter/ray/markets.ts": [
      ['Promise<{ bets: CollectBetDto[]; matchResult?: Record<string, unknown> }>', 'Promise<CollectBetDto[]>'],
      ['if (res.code !== 200 || !res.result) return { bets: [] };', 'if (res.code !== 200 || !res.result) return [];'],
      [`  const { id, status, round, start_time } = res.result;
  // 仅透传原始字段；异常判断由 matcher 执行，不新增请求。
  const matchResult = {
    id, status, round, start_time,
    team: payload.team?.map(({ pos, team_id }) => ({ pos, team_id })),
    odds: payload.odds?.filter(row => row.group_name === "获胜者").map(row => ({
      match_stage: row.match_stage, odds_group_id: row.odds_group_id, odds_id: row.odds_id,
      team_id: row.team_id, status: row.status, win: row.win, group_name: row.group_name,
    })),
  };
  return { bets: reportRayOddsPayloadToSaveBetRows(payload, betRe, gameCode), matchResult };`,
      '  return reportRayOddsPayloadToSaveBetRows(payload, betRe, gameCode);'],
    ],
  }[file] || [];
  for (const [before, after] of resultChanges) {
    assert.equal(source.split(before).length, 2, `${file}: exact raw RAY result forwarding`);
    source = source.replace(before, after);
  }
  const hooks = {
    "packages/venue-adapter/ray/markets.ts": [
      'import { updateRayMapOutcomes } from "./rayMapOutcome";\n',
      '  updateRayMapOutcomes(matchId, payload, betRe, gameCode);\n',
    ],
    "packages/venue-adapter/ray/collect.ts": [
      'import { clearRayMapOutcomes, retainRayMapOutcomes } from "./rayMapOutcome";\n',
      '        retainRayMapOutcomes(list.map(row => String(row.id)));\n',
      '    clearRayMapOutcomes();\n',
    ],
    "packages/venue-adapter/ray/index.ts": [
      'export { lookupRayMapOutcome } from "./rayMapOutcome";\n',
    ],
  }[file];
  if (!hooks)
    return source;
  source = source.replaceAll("\r\n", "\n");
  for (const hook of hooks) {
    assert.equal(source.split(hook).length, 2, `${file}: exact display-only RAY outcome hook`);
    source = source.replace(hook, "");
  }
  return source;
}
