// [changmen 扩展] 已提交的 RAY 监控迁移：固定完整实现，只还原公共收尾中的两处命名迁移。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { verifyRayClientMonitorSource } from "./ray-client-monitor-boundary.mjs";

export const rayFrontendCommit = "2391dc9df446dcb7ed85030a3faca3696b0d0da7";
export const rayFrontendSources = Object.freeze([
  "client/web/src/runtime/orderPolling/ray.ts",
  "server/backend/core/account/ray_monitor_orders.js",
  ...["api", "autoMakeup", "contextStore", "contexts", "lifecycle", "match", "runtime", "state", "types"].map(name => `client/web/src/runtime/rayOrderMonitor/${name}.ts`),
  "client/web/src/runtime/rayOrderMonitor/localOrders.ts",
  "client/web/src/stores/account/rayOrderBindings.ts",
]);
export function verifyRayFrontendSources(readSource) {
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
  if (file !== "client/web/src/runtime/providers.ts")
    return source;
  const commit = "adb333bf24b6ba6aa3e441009b56f874a23f6ed9";
  for (const [path, current] of [[file, source], ["client/web/src/runtime/orderMonitoring/rayOrders.ts", readSource("client/web/src/runtime/orderMonitoring/rayOrders.ts")]]) {
    const fixed = execFileSync("git", ["show", `${commit}:${path}`], { encoding: "utf8" });
    assert.equal(current.replaceAll("\r\n", "\n"), fixed.replaceAll("\r\n", "\n"), `${path}: complete committed passive RAY observation`);
  }
  return "export { getProvider, supportedBetProviders } from \"@/runtime/venueAdapters\";\n";
}
