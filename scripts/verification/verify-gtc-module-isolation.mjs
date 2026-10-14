import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

const forbidden = /@\/stores\/(?:loseOrderStore|account\/(?:betGateway)|betting\/(?:successMarkers|pendingOrderBind|arbOrderBind|autoBet\/(?:phases\/(?:prepareArbAttempt|checkArbLegs|placeArbLegs|finalizeArbBet|settleBothArbLegs|finalizeArbMarkers)|arbLegSettle|arbMakeUpFromRejects|retryFailedLeg)))(?:["'/]|$)/;
let checked = 0;
for (const file of files("client/web/src/orderModes/gtc")) {
  if (!/\.(?:ts|vue)$/.test(file) || file.endsWith(".test.ts"))
    continue;
  const source = fs.readFileSync(file, "utf8");
  const runtimeImports = source.split("\n").filter(line => !/^import type\b/.test(line)).join("\n");
  assert(!forbidden.test(runtimeImports), `${file}: GTC cannot import FOK private state/actions`);
  const actionHooks = source.match(/[\w.]+\.\$onAction/g) ?? [];
  assert(actionHooks.every(hook => ["oddsStore.$onAction", "sportOddsStore.$onAction"].includes(hook)), `${file}: GTC cannot intercept FOK actions`);
  checked++;
}
for (const file of files("packages/venue-adapter/polymarket/gtc")) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts"))
    continue;
  assert(!/from\s+["']\.\.\/bet["']/.test(fs.readFileSync(file, "utf8")), `${file}: GTC cannot borrow FOK preparation or its contract`);
  checked++;
}
// [changmen 扩展] 独立监控只恢复、读取、核对和撤原单；不拥有首次发送或 RAY 生命周期。
for (const file of files("client/web/src/runtime/gtcOrderMonitor")) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  const source = fs.readFileSync(file, "utf8");
  assert(!forbidden.test(source), `${file}: GTC monitor cannot import FOK private state/actions`);
  assert(!/\b(?:pmPostGtc|prepareGtcBuy|checkGtcBuy|placeOtherLeg|prepareOtherLeg|startRayOrderMonitoring|stopRayOrderMonitoring|resetRayOrderResults)\s*\(/.test(source), `${file}: GTC monitor cannot submit orders or control RAY`);
  assert(!/kind:\s*["'](?:authorize_pm|authorize_other|submit)["']/.test(source), `${file}: GTC monitor cannot authorize or replay original sends`);
  checked++;
}
const gateway = fs.readFileSync("client/web/src/orderModes/gtc/gateway.ts", "utf8");
// [changmen 扩展] 账号预检与传统对侧发送共用公共入口；GTC 不复制旁路或自行调度确认。
assert(/useAccountStore\(\)\.checkBetting\(/.test(gateway) && /accounts\.betting\(/.test(gateway), "GTC account operations must reuse the common gateway");
assert(!/ensureSharedVaultKeyForAccount|resolveVenueStakeFromPlanCny|provider\.betting|publishBettingEvent|notifyPendingVenueConfirm|markSuccessfulBet|updateVenueOrders/.test(gateway), "GTC compatibility gateway cannot duplicate common account actions");
for (const obsolete of ["autoEntry.ts", "execute.ts", "prepare.ts", "check.ts"])
  assert(!fs.existsSync(`client/web/src/orderModes/gtc/${obsolete}`), `obsolete GTC pair pipeline must be removed: ${obsolete}`);
const bridge = fs.readFileSync("client/web/src/orderModes/gtc/arbLeg.ts", "utf8");
assert(!/placeArbLegs|finalizeArbBet|settleBothArbLegs|showRejectDetectionTip|syncActiveBetPhase/.test(bridge), "GTC bridge cannot own public phases");
for (const removed of ["report.ts", "orderStore.ts", "orderStats.ts", "financialStatistics.ts", "FinancialOrders.vue", "OrderList.vue"])
  assert(!fs.existsSync(`client/web/src/orderModes/gtc/${removed}`), `GTC execution mode must not create a second ordinary order/statistics/report pipeline: ${removed}`);
// [changmen 扩展] Shared order transport must not require GTC recovery or duplicate its writer.
assert(!fs.existsSync("server/backend/core/orderModes/gtc/orderStore.js"), "GTC must reuse the ordinary order writer");
const transport = fs.readFileSync("server/backend/core/orderModes/router.js", "utf8");
assert.equal(transport.match(/from\s+["']([^"']+)["']/)?.[1], "../account/account_service.js");
assert(!/\b(?:import|await|db|listPmGtc|fetchOrderExecutionIdentities)\b/.test(transport), "shared order endpoints must directly export their original handlers");
const metadata = fs.readFileSync("server/backend/core/orderModes/orderMetadata.js", "utf8");
assert(!/\b(?:import|await|fetch|query)\b/.test(metadata), "mode metadata must reuse the ordinary writer's prefetched rows without I/O");
process.stdout.write(`${JSON.stringify({ independentGtcModuleFiles: checked, noFokPrivateImports: true, noFokActionHooks: true, sharedAccountGateway: true, modeSpecificPreparation: true })}\n`);
