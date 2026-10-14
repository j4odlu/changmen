// [changmen 扩展] 仅还原逐项审查的统一流程增量；还原后仍由原保护比较整个固定基线模块。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { gitSource, moduleTokens } from "./fok-exact-boundaries.mjs";
import { restoreRayFinalizeSource, verifyRayFrontendSources } from "./ray-frontend-boundary.mjs";

const root = "client/web/src/stores/betting/autoBet/";
const phases = `${root}phases/`;
const contractPath = "scripts/verification/unified-arb-capability-contracts.json";

// 每一项完整条件、正文、参数、上下文和出现次数均受保护；不按名字/模式批量删除。
export const UNIFIED_ARBITRAGE_BOUNDARIES = Object.freeze({
  [`${phases}prepareArbAttempt.ts`]: [
    ["const pmOrderMode = params.pmOrderMode === \"GTC\" && options.some(leg => leg.type === \"Polymarket\") ? \"GTC\" : undefined;", ""],
    ["if (pmOrderMode === \"GTC\" && (!betBothLegs || options.filter(leg => leg.type === \"Polymarket\").length !== 1)) { trace?.finish(\"skip\", \"PM GTC 当前只支持一条 PM 腿的双边套利\"); return null; }", ""],
    ["return { ...(pmOrderMode ? { pmOrderMode } : {}), legA,", "return { legA,"],
  ],
  [`${phases}checkArbLegs.ts`]: [
    ["skipAccountRate: resolveSkipAccountRate(\"A\", ready), ...(legA.type === \"Polymarket\" && ready.pmOrderMode === \"GTC\" ? { pmOrderMode: ready.pmOrderMode } : {}),", "skipAccountRate: resolveSkipAccountRate(\"A\", ready),"],
    ["skipAccountRate: resolveSkipAccountRate(\"B\", ready), ...(legB.type === \"Polymarket\" && ready.pmOrderMode === \"GTC\" ? { pmOrderMode: ready.pmOrderMode } : {}),", "skipAccountRate: resolveSkipAccountRate(\"B\", ready),"],
  ],
  [`${phases}placeArbLegs.ts`]: [
    ["if (checked.pmOrderMode === \"GTC\" && hasPm) { const { prepareGtcLegExecution } = await import(\"@/orderModes/gtc/arbLeg\"); checked.originalExecution = params.originalExecution = await prepareGtcLegExecution(params, checked); } const original = checked.originalExecution;", ""],
    ["return original?.legs.get(leg)?.submit() ?? accountStore.betting(account, leg, waitSec, placeOpts);", "return accountStore.betting(account, leg, waitSec, placeOpts);"],
    ["const execution = original?.legs.get(leg); if (execution) { execution.validate(); continue; }", ""],
    ["const tasks = [ submitLeg(accountA!, legA), submitLeg(accountB!, legB), ]; const pair = original ? (await Promise.allSettled(tasks)).map(row => row.status === \"fulfilled\" ? row.value : undefined) : await Promise.all(tasks);", "const pair = await Promise.all([ submitLeg(accountA!, legA), submitLeg(accountB!, legB), ]);"],
    ["if (original || resultA?.success || !pair.some(r => r?.success))", "if (resultA?.success || !pair.some(r => r?.success))"],
    ["if (resultA.success && (original?.legs.get(legA)?.canContinueOriginalPair() ?? true))", "if (resultA.success)"],
    ["const reason = resultA.success ? \"首腿已受理，原单事实或发送窗口不允许继续第二腿\" : resultA.pmSubmitUnknown ? \"首腿提交结果未知，未发送第二腿\" : \"首腿提交返回失败，未发送第二腿\";", "const reason = resultA.pmSubmitUnknown ? \"首腿提交结果未知，未发送第二腿\" : \"首腿提交返回失败，未发送第二腿\";"],
    ["if (!original && resultB?.success && !resultA?.success)", "if (resultB?.success && !resultA?.success)"],
    ["if (original?.actions.retry !== false && betBothLegs && resultA?.success && !resultB?.success && !resultB?.pmSubmitUnknown && attemptedB)", "if (betBothLegs && resultA?.success && !resultB?.success && !resultB?.pmSubmitUnknown && attemptedB)"],
  ],
  [`${phases}settleBothArbLegs.ts`]: [
    ["import type { OriginalLegFacts } from \"@/domain/betting/originalLegExecution\";", ""],
    ["export interface ArbLegSettleSnapshot { factsA?: OriginalLegFacts; factsB?: OriginalLegFacts;", "export interface ArbLegSettleSnapshot {"],
    ["const original = placed.originalExecution; const maxWait = original ? Math.max(0, ...[placed.legA, placed.legB].map((leg, index) => (index === 0 ? resultA : resultB)?.success ? original.legs.get(leg)?.rejectWaitSec ?? 0 : 0)) : maxLegRejectWaitSec(config, successAccounts);", "const maxWait = maxLegRejectWaitSec(config, successAccounts);"],
    ["const execution = original?.legs.get(leg); const synced = execution ? await execution.confirm(result) : await settleArbLegUntilTerminal(account, result, {", "const synced = await settleArbLegUntilTerminal(account, result, {"],
    ["if (execution) { if (side === \"A\") snapshot.factsA = execution.facts(); else snapshot.factsB = execution.facts(); if (synced.orders.length) snapshot.boundLegLabels.push(leg.type); return; }", ""],
    ["const pendingA = settleA && isPendingConfirmVenueProvider(accountA!.provider) && (!original || (original.legs.get(legA)?.rejectWaitSec ?? 0) === 0);", "const pendingA = settleA && isPendingConfirmVenueProvider(accountA!.provider);"],
    ["const pendingB = settleB && isPendingConfirmVenueProvider(accountB!.provider) && (!original || (original.legs.get(legB)?.rejectWaitSec ?? 0) === 0);", "const pendingB = settleB && isPendingConfirmVenueProvider(accountB!.provider);"],
  ],
  [`${phases}finalizeArbBet.ts`]: [
    ["const settle = await settleBothArbLegs(params, placed); const actions = placed.originalExecution?.actions; await placed.originalExecution?.close(); cancelQueuedMakeUpForRejectedAnchor(params, placed, settle);", "const settle = await settleBothArbLegs(params, placed); cancelQueuedMakeUpForRejectedAnchor(params, placed, settle);"],
    ["if (actions?.registerRejectMonitor !== false) { registerRayLeg(\"A\"); registerRayLeg(\"B\"); }", "registerRayLeg(\"A\"); registerRayLeg(\"B\");"],
    ["const makeup = actions?.makeup === false ? { enqueuedForLegA: false, enqueuedForLegB: false } : await applyArbMakeUpFromRejects(", "const makeup = await applyArbMakeUpFromRejects("],
    ["if (actions?.broadcast !== false) sendArbBettingMessageIfNeeded(params, placed, settle); if (placed.originalExecution) params.setMessage(placed.originalExecution.summary().message);", "sendArbBettingMessageIfNeeded(params, placed, settle);"],
    ["if (actions?.autoSell !== false && useUserStore().extensionPrefs?.arbFailAutoSell?.enabled === true)", "if (useUserStore().extensionPrefs?.arbFailAutoSell?.enabled === true)"],
  ],
  [`${phases}finalizeArbMarkers.ts`]: [
    ["import type { BetOption } from \"@changmen/client-core/models/betOption\";", ""],
    ["const markLeg = ( leg: BetOption, result: typeof resultA,", "const markLeg = ( result: typeof resultA,"],
    ["const execution = placed.originalExecution?.legs.get(leg); if (execution) { execution.markConfirmed(); return; }", ""],
    ["markLeg(legA, resultA, accountA, settle.rejectA, settle.pendingConfirmA, legA.target, legA.odds);", "markLeg(resultA, accountA, settle.rejectA, settle.pendingConfirmA, legA.target, legA.odds);"],
    ["markLeg(legB, resultB, accountB, settle.rejectB, settle.pendingConfirmB, legB.target, legB.odds);", "markLeg(resultB, accountB, settle.rejectB, settle.pendingConfirmB, legB.target, legB.odds);"],
  ],
  [`${phases}finalizeArbMessaging.ts`]: [
    ["const { trace } = params; if (placed.originalExecution) { const summary = placed.originalExecution.summary(); trace?.finish(summary.traceStatus, summary.message); return; }", "const { trace } = params;"],
  ],
  [`${phases}syncArbFinalizeUi.ts`]: [
    ["import { scheduleActiveBetRunRemoval, syncActiveBetAfterRejectSync, syncActiveBetFail, syncActiveBetPhase } from \"@/stores/betting/activeBetRunSync\";", "import { syncActiveBetAfterRejectSync } from \"@/stores/betting/activeBetRunSync\";"],
    ["const makeupQueued = makeup.enqueuedForLegA || makeup.enqueuedForLegB; if (placed.originalExecution) { const summary = placed.originalExecution.summary(); if (summary.failed) syncActiveBetFail(betId, summary.message); else syncActiveBetPhase(betId, \"syncing\", summary.message); scheduleActiveBetRunRemoval(betId); return { okA, okB, makeupQueued }; }", "const makeupQueued = makeup.enqueuedForLegA || makeup.enqueuedForLegB;"],
  ],
  [`${phases}types.ts`]: [
    ["import type { OriginalExecutionLifecycle } from \"@/domain/betting/originalLegExecution\";", ""],
    ["export interface ArbBetReady { pmOrderMode?: \"FOK\" | \"GTC\"; originalExecution?: OriginalExecutionLifecycle;", "export interface ArbBetReady {"],
    ["export interface ArbBetAttemptParams { pmOrderMode?: \"FOK\" | \"GTC\"; originalExecution?: OriginalExecutionLifecycle;", "export interface ArbBetAttemptParams {"],
  ],
  "client/web/src/stores/account/betGateway.ts": [
    ["export type CheckBettingOpts = ResolveVenueStakeOpts & { pmOrderMode?: \"FOK\" | \"GTC\";", "export type CheckBettingOpts = ResolveVenueStakeOpts & {"],
    ["const checked = pm && opts?.pmOrderMode === \"GTC\" ? await (await import(\"@changmen/venue-adapter/polymarket/gtc\")).checkGtcBuy(account, option, signingTask, true) : await provider.checkBet(account, option, { role: opts?.role ?? \"execute\", prepareSigning: signingTask });", "const checked = await provider.checkBet(account, option, { role: opts?.role ?? \"execute\", prepareSigning: signingTask });"],
  ],
  [`${root}executeArbBet.ts`]: [
    ["import { captureArbExecutionSelection } from \"@/stores/betting/execution/selection\";", ""],
    ["const mode = captureArbExecutionSelection().orderMode; const attempt: ArbBetAttemptParams = { ...params, ...(mode === \"GTC\" ? { pmOrderMode: mode } : {}) };", "const attempt: ArbBetAttemptParams = { ...params };"],
    // eslint-disable-next-line no-template-curly-in-string -- [changmen 扩展] 精确保护原源码中的模板插值。
    ["finally { if (attempt.originalExecution) { try { await attempt.originalExecution.close(); } catch (error) { observationOutcome = \"exception\"; observationMessage = errorMessage(error); params.setMessage(`原单发送窗口收尾失败：${errorMessage(error)}`); } } finishExecutionObservation(", "finally { finishExecutionObservation("],
  ],
});
for (const replacements of Object.values(UNIFIED_ARBITRAGE_BOUNDARIES)) {
  replacements.forEach(Object.freeze);
  Object.freeze(replacements);
}

export function restoreUnifiedArbitrageSource(file, source, replaceExact, required = false) {
  const replacements = UNIFIED_ARBITRAGE_BOUNDARIES[file];
  if (!replacements)
    return source;
  // 旧完整基线仍可由原比较验证；真实统一入口另强制所有新增契约存在。
  const present = /originalExecution|pmOrderMode|captureArbExecutionSelection/.test(source);
  if (!present && !required)
    return source;
  assert(present, `${file}: required reviewed unified boundary missing`);
  for (const [before, after] of replacements) source = replaceExact(source, before, after);
  return source;
}

export function readReviewedCapabilityContracts(source) {
  assert.equal(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"), "f27a3c5d5eca0c1bb53358bc5737ec1433ca901a4235fea8ac0a48d8d9790552", "immutable reviewed capability snapshot");
  return JSON.parse(source);
}

export function verifyUnifiedArbitrageContract(readSource, replaceExact) {
  verifyRayFrontendSources(readSource);
  const contracts = readReviewedCapabilityContracts(fs.readFileSync(contractPath, "utf8"));
  assert.deepEqual(Object.keys(contracts).sort(), [
    "client/web/src/domain/betting/originalLegExecution.ts",
    "client/web/src/orderModes/gtc/arbLeg.ts",
    "client/web/src/orderModes/router.ts",
    "client/web/src/stores/betting/execution/selection.ts",
  ].sort(), "only four complete reviewed capability contracts");
  for (const [file, source] of Object.entries(contracts))
    assert.equal(readSource(file).replace(/\r\n/g, "\n"), source, `${file}: complete reviewed unified capability contract`);
  for (const file of Object.keys(UNIFIED_ARBITRAGE_BOUNDARIES)) {
    const restored = restoreRayFinalizeSource(file, restoreUnifiedArbitrageSource(file, readSource(file), replaceExact, true), replaceExact);
    assert.deepEqual(moduleTokens(restored), moduleTokens(gitSource("e901bb596952256284cd8a9eb8b73b572c963915", file)), `${file}: complete fixed-baseline module at pre-unification served source after exact restoration`);
  }
  return { completeCapabilityContracts: Object.keys(contracts).length, precisePublicModules: Object.keys(UNIFIED_ARBITRAGE_BOUNDARIES).length };
}
