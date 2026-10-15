// [changmen 扩展] 仅还原逐项审查的统一流程增量；还原后仍由原保护比较整个固定基线模块。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { gitSource, moduleTokens } from "./fok-exact-boundaries.mjs";
import { restoreRayFinalizeSource, verifyRayFrontendSources } from "./ray-frontend-boundary.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
import { restoreGtcSelectionHistorySource } from "./gtc-selection-history-boundary.mjs";

const root = "client/web/src/stores/betting/autoBet/";
const phases = `${root}phases/`;
const contractPath = "scripts/verification/unified-arb-capability-contracts.json";
// [changmen 扩展] 2026-10-14 校时续租修复：仅变更 GTC 首次发送准备，原快照与 FOK 基线保持固定。
const gtcClockCorrection = [
  ["const { submit: _submit, validate: _validate, ...frozenPm } = prepared;", "const { submit: _submit, validate: _validate, prepareSubmit: _prepareSubmit, ...frozenPm } = prepared;"],
  ["void _submit; void _validate;", "void _submit; void _validate; void _prepareSubmit;"],
  ["async function submitPmCore(): Promise<BetResult> {\n    checkSession(); prepared.validate();", "async function submitPmCore(): Promise<BetResult> {\n    checkSession(); await prepared.prepareSubmit(); checkSession();"],
];

// [changmen 扩展] 首次发送按 A8 success 继续；只登记完整、精确的单腿契约修改。
const gtcInitialPairCorrection = {
  "client/web/src/domain/betting/originalLegExecution.ts": [
    [
      "export interface OriginalLegExecution {\n  validate: () => void;\n  submit: () => Promise<BetResult>;\n  canContinueOriginalPair: () => boolean;\n  /** 等待由公共 settle 承担，原单确认不再重复等待。 */\n  confirm: (result: BetResult) => Promise<{\n    orders: VenueOrder[];",
      "export interface OriginalLegExecution {\n  validate: () => void;\n  submit: () => Promise<BetResult>;\n  /** 等待由公共 settle 承担，原单确认不再重复等待。 */\n  confirm: (result: BetResult) => Promise<{\n    orders: VenueOrder[];"
    ],
    [
      "export interface OriginalExecutionLifecycle {\n  legs: ReadonlyMap<BetOption, OriginalLegExecution>;\n  actions: { retry: boolean; makeup: boolean; autoSell: boolean; registerRejectMonitor: boolean; broadcast: boolean };\n  close: () => Promise<void>;\n  summary: () => { message: string; traceStatus: \"success\" | \"partial\" | \"fail\"; failed: boolean };\n}",
      "export interface OriginalExecutionLifecycle {\n  legs: ReadonlyMap<BetOption, OriginalLegExecution>;\n  actions: { retry: boolean; makeup: boolean; autoSell: boolean; registerRejectMonitor: boolean; broadcast: boolean };\n  /** [changmen 扩展] 结束首次发送的本地占用，后台核对不参与两腿发送裁决。 */\n  finishSubmission: () => void;\n  close: () => Promise<void>;\n  summary: () => { message: string; traceStatus: \"success\" | \"partial\" | \"fail\"; failed: boolean };\n}"
    ]
  ],
  "client/web/src/orderModes/gtc/arbLeg.ts": [
    [
      "import type { ArbBetAttemptParams, ArbBetChecked } from \"@/stores/betting/autoBet/phases/types\";\nimport { BetResult } from \"@changmen/client-core/models/betResult\";\nimport { getExchange, resolveAccountCurrency } from \"@changmen/shared/currency\";\nimport { gtcStateLabel, gtcUnits } from \"@changmen/shared/pm_gtc\";\nimport { getAuthSessionVersion, isAuthSessionCurrent } from \"@/api/client\";\nimport { useUserStore } from \"@/stores/userStore\";\nimport { notifyBet } from \"@/shared/betNotification\";\nimport { createGtc } from \"./api\";\nimport { placeOtherLeg } from \"./gateway\";\nimport { findGtcOtherOrder } from \"./otherFacts\";\nimport { settleGtcOtherLeg } from \"./otherOrders\";\nimport { gtcExecutionResult } from \"./result\";\nimport { gtcPmNotice } from \"./notifications\";\nimport { acceptGtc, currentGtc, markGtcLegOnce, mutateGtc, pollGtc, pollGtcOther, refreshGtcRecords, startGtcRuntime } from \"./runtime\";\nimport { assertGtcHistoryAllowsLeg } from \"./successMarkers\";\nimport { gtcProgress } from \"./gtcProgressState\";",
      "import type { ArbBetAttemptParams, ArbBetChecked } from \"@/stores/betting/autoBet/phases/types\";\nimport { BetResult } from \"@changmen/client-core/models/betResult\";\nimport { getExchange, resolveAccountCurrency } from \"@changmen/shared/currency\";\nimport { gtcStateLabel } from \"@changmen/shared/pm_gtc\";\nimport { getAuthSessionVersion, isAuthSessionCurrent } from \"@/api/client\";\nimport { useUserStore } from \"@/stores/userStore\";\nimport { notifyBet } from \"@/shared/betNotification\";\nimport { createGtc } from \"./api\";\nimport { prepareOtherLeg } from \"./gateway\";\nimport { findGtcOtherOrder } from \"./otherFacts\";\nimport { settleGtcOtherLeg } from \"./otherOrders\";\nimport { gtcExecutionResult } from \"./result\";\nimport { gtcPmNotice } from \"./notifications\";\nimport { acceptGtc, beginGtcInitialDispatch, currentGtc, markGtcLegOnce, mutateGtc, pollGtc, refreshGtcRecords, startGtcRuntime } from \"./runtime\";\nimport { assertGtcHistoryAllowsLeg } from \"./successMarkers\";\nimport { gtcProgress } from \"./gtcProgressState\";"
    ],
    [
      "  const other = pmA ? checked.legB : checked.legA;\n  const account = (pmA ? checked.accountA : checked.accountB)!;\n  const otherAccount = (pmA ? checked.accountB : checked.accountA)!;\n  const historyAccounts = [account, otherAccount].filter(row => params.config.noSameBet || row.maxBetCount || row.lastOdds);\n  if (historyAccounts.length)\n    await refreshGtcRecords(params.bet.id, historyAccounts.map(row => row.accountId));\n  assertGtcHistoryAllowsLeg(owner, account, params.bet.id, pm.target, pm.odds, params.config.noSameBet);\n  assertGtcHistoryAllowsLeg(owner, otherAccount, params.bet.id, other.target, other.odds, params.config.noSameBet);\n  const { prepareGtcBuy, pmSubmitMaker } = await import(\"@changmen/venue-adapter/polymarket/gtc\");\n  const prepared = await prepareGtcBuy(account, pm);\n  const otherBinding = () => JSON.stringify([otherAccount.accountId, otherAccount.provider, otherAccount.token, otherAccount.gateway, otherAccount.currency, other.betMoney, other.odds, other.matchId, other.betId, other.itemId, other.target, other.data]);\n  const frozenOther = otherBinding();\n  const checkSession = () => {",
      "  const other = pmA ? checked.legB : checked.legA;\n  const account = (pmA ? checked.accountA : checked.accountB)!;\n  const otherAccount = (pmA ? checked.accountB : checked.accountA)!;\n  const submitOther = prepareOtherLeg(otherAccount, other, checked.linkId);\n  const otherBinding = () => JSON.stringify([otherAccount.accountId, otherAccount.provider, otherAccount.token, otherAccount.gateway, otherAccount.currency, other.betMoney, other.odds, other.matchId, other.betId, other.itemId, other.target, other.data]);\n  const frozenOther = otherBinding();\n  const checkSession = () => {"
    ],
    [
      "  };\n  const validateOther = () => {\n    checkSession();\n    if (otherBinding() !== frozenOther || !other.data)\n      throw new Error(\"GTC 对侧冻结预检或账号已改变\");\n  };\n  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));\n  const otherFx = getExchange(resolveAccountCurrency(otherAccount.provider, otherAccount.currency));\n  if ((pm.stakeExchange != null && pm.stakeExchange !== fx)",
      "  };\n  const validateOther = () => {\n    checkSession();\n    if (otherBinding() !== frozenOther || !other.data || other.checkError)\n      throw new Error(\"GTC 对侧冻结预检或账号已改变\");\n  };\n  const historyAccounts = [account, otherAccount].filter(row => params.config.noSameBet || row.maxBetCount || row.lastOdds);\n  if (historyAccounts.length)\n    await refreshGtcRecords(params.bet.id, historyAccounts.map(row => row.accountId));\n  assertGtcHistoryAllowsLeg(owner, account, params.bet.id, pm.target, pm.odds, params.config.noSameBet);\n  assertGtcHistoryAllowsLeg(owner, otherAccount, params.bet.id, other.target, other.odds, params.config.noSameBet);\n  const { prepareGtcBuy, pmSubmitMaker } = await import(\"@changmen/venue-adapter/polymarket/gtc\");\n  const prepared = await prepareGtcBuy(account, pm);\n\n  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));\n  const otherFx = getExchange(resolveAccountCurrency(otherAccount.provider, otherAccount.currency));\n  if ((pm.stakeExchange != null && pm.stakeExchange !== fx)"
    ],
    [
      "  const ratio = Math.min(Number(prepared.shares) * fx, other.betMoney * otherFx * other.odds) / costs;\n  if (!Number.isFinite(ratio) || ratio < params.config.profit)\n    throw new Error(`GTC 签单本金与份数舍入后利润不足：${ratio.toFixed(6)}`);\n  const { submit: _submit, validate: _validate, prepareSubmit: _prepareSubmit, ...frozenPm } = prepared;\n  void _submit; void _validate; void _prepareSubmit;\n  const plan: GtcPlan = { ...frozenPm, playerId: Number(account.accountId), otherPlayerId: Number(otherAccount.accountId), originalPmLeg: pmA ? \"A\" : \"B\", otherProvider: otherAccount.provider, otherTarget: other.target, otherOdds: other.odds, otherStake: other.betMoney, matchId: params.match.id, betRowId: params.bet.id, otherVenueMatchId: other.matchId, otherVenueItemId: other.itemId, linkId: checked.linkId, tokenId: pm.itemId, conditionId: pm.betId, target: pm.target, match: params.match.title, bet: params.bet.getBetName(), item: pm.target, fx, parallel: params.config.betSorting === \"Parallel\" };\n  const id = crypto.randomUUID();\n  acceptGtc(await createGtc(id, pmSubmitMaker(account), plan));\n  const current = () => currentGtc(id);\n  let closeTask: Promise<void> | undefined;\n  const close = () => closeTask ??= mutateGtc(id, { kind: \"close\" }).then(() => {}).catch((error) => { closeTask = undefined; throw error; });\n  const summary = () => gtcExecutionResult(current());\n\n  async function submitPmCore(): Promise<BetResult> {\n    checkSession(); await prepared.prepareSubmit(); checkSession();\n    await mutateGtc(id, { kind: \"authorize_pm\" });\n    checkSession();\n    try {\n      const ack = await prepared.submit();\n      const accepted = ack.success === true && Boolean(ack.orderID);\n      await mutateGtc(id, { kind: \"ack\", state: accepted ? \"accepted\" : ack.success === false ? \"rejected\" : \"unknown\", orderId: ack.orderID, message: accepted ? \"\" : ack.errorMsg || \"官方未确认受理\" });\n      const result = new BetResult(\"Polymarket\", accepted, accepted ? \"GTC 已受理，成交继续核对\" : \"GTC 结果待核实\", undefined, ack);\n      result.orderId = ack.orderID ?? null; result.link = checked.linkId; result.pending = accepted;\n      result.pmSubmitUnknown = !accepted && ack.success !== false;\n      result.observation = pm.observation; result.saveLog(account);\n      if (accepted)\n        await pollGtc(id).catch(() => {});\n      result.message = gtcStateLabel(current());\n      return result;\n    }\n    catch (error) {\n      const message = error instanceof Error ? error.message : \"GTC 提交结果待核实\";\n      await mutateGtc(id, { kind: \"ack\", state: \"unknown\", message });\n      const result = new BetResult(\"Polymarket\", false, message);\n      result.pmSubmitUnknown = true; result.orderId = current().orderId || plan.orderHash; result.link = checked.linkId;\n      result.observation = pm.observation; result.saveLog(account);\n      return result;\n    }\n  }\n\n  return {\n    // [changmen 扩展] 原 GTC V1 许可范围保持：首次原腿一次发送，未完结由人工处理。\n    actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false },\n    close,\n    summary,\n    legs: new Map([",
      "  const ratio = Math.min(Number(prepared.shares) * fx, other.betMoney * otherFx * other.odds) / costs;\n  if (!Number.isFinite(ratio) || ratio < params.config.profit)\n    throw new Error(`GTC 签单本金与份数舍入后利润不足：${ratio.toFixed(6)}`);\n  // [changmen 扩展] 签单、时钟和冻结输入全部就绪后才创建执行；提交时只复核失效或已消费。\n  await prepared.prepareSubmit();\n  validateOther(); prepared.validate();\n  const { submit: _submit, validate: _validate, prepareSubmit: _prepareSubmit, ...frozenPm } = prepared;\n  void _submit; void _validate; void _prepareSubmit;\n  const plan: GtcPlan = { ...frozenPm, playerId: Number(account.accountId), otherPlayerId: Number(otherAccount.accountId), originalPmLeg: pmA ? \"A\" : \"B\", otherProvider: otherAccount.provider, otherTarget: other.target, otherOdds: other.odds, otherStake: other.betMoney, matchId: params.match.id, betRowId: params.bet.id, otherVenueMatchId: other.matchId, otherVenueItemId: other.itemId, linkId: checked.linkId, tokenId: pm.itemId, conditionId: pm.betId, target: pm.target, match: params.match.title, bet: params.bet.getBetName(), item: pm.target, fx, parallel: params.config.betSorting === \"Parallel\" };\n  const id = crypto.randomUUID();\n  acceptGtc(await createGtc(id, pmSubmitMaker(account), plan));\n  const finishSubmission = beginGtcInitialDispatch(id);\n  const current = () => currentGtc(id);\n  let closeTask: Promise<void> | undefined;\n  const close = () => {\n    finishSubmission();\n    return closeTask ??= mutateGtc(id, { kind: \"close\" }).then(() => {}).catch((error) => { closeTask = undefined; throw error; });\n  };\n  const summary = () => gtcExecutionResult(current());\n\n  async function submissionFailure(leg: \"PM\" | \"OTHER\", error: unknown, sent: boolean): Promise<BetResult> {\n    const message = error instanceof Error ? error.message : String(error);\n    const result = new BetResult(leg === \"PM\" ? \"Polymarket\" : otherAccount.provider, false, message,\n      undefined, sent ? undefined : { pmSubmitNotSent: true });\n    result.pmSubmitUnknown = sent; result.link = checked.linkId;\n    result.orderId = sent && leg === \"PM\" ? current().orderId || plan.orderHash : null;\n    result.observation = leg === \"PM\" ? pm.observation : other.observation;\n    // [changmen 扩展] 尚未调用场馆发送不等于超时未知；授权仍不可重用，首腿回执不受影响。\n    await mutateGtc(id, !sent ? { kind: \"not_sent\", leg, message }\n      : leg === \"PM\" ? { kind: \"ack\", state: \"unknown\", message }\n        : { kind: \"other\", state: \"unknown\", message }).catch((failure) => {\n      result.message += `；执行状态记录失败：${failure instanceof Error ? failure.message : String(failure)}`;\n    });\n    try { result.saveLog(leg === \"PM\" ? account : otherAccount); }\n    catch { /* 记录异常不改变发送事实或中断另一腿收尾。 */ }\n    return result;\n  }\n\n  async function submitPmCore(): Promise<BetResult> {\n    let sent = false;\n    let received: BetResult | undefined;\n    try {\n      checkSession(); await prepared.prepareSubmit(); checkSession();\n      await mutateGtc(id, { kind: \"authorize_pm\" });\n      checkSession();\n      sent = true;\n      const ack = await prepared.submit();\n      if (ack.pmSubmitNotSent && ack.success === false && !ack.orderID)\n        return submissionFailure(\"PM\", new Error(ack.errorMsg || \"PM 发送前检查失败\"), false);\n      const accepted = ack.success === true && Boolean(ack.orderID);\n      const result = new BetResult(\"Polymarket\", accepted, accepted ? \"GTC 已受理，成交继续核对\" : \"GTC 结果待核实\", undefined, ack);\n      result.orderId = ack.orderID ?? null; result.link = checked.linkId; result.pending = accepted;\n      result.pmSubmitUnknown = !accepted && ack.success !== false;\n      received = result;\n      await mutateGtc(id, { kind: \"ack\", state: accepted ? \"accepted\" : ack.success === false ? \"rejected\" : \"unknown\", orderId: ack.orderID, message: accepted ? \"\" : ack.errorMsg || \"官方未确认受理\" });\n      result.observation = pm.observation; result.saveLog(account);\n      result.message = gtcStateLabel(current());\n      return result;\n    }\n    catch (error) {\n      // [changmen 扩展] 已取得回执后，记录或展示异常不能把首腿成功改为未知或跳过第二腿。\n      if (received) return received;\n      return submissionFailure(\"PM\", error, sent);\n    }\n  }\n\n  return {\n    // [changmen 扩展] 原 GTC V1 许可范围保持：首次原腿一次发送，未完结由人工处理。\n    actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false },\n    finishSubmission,\n    close,\n    summary,\n    legs: new Map(["
    ],
    [
      "          await notifyBet(account, pm, async () => { placed = await submitPmCore(); return summary(); }, gtcPmNotice, checked.waitSec, { matchTitle: params.match.title, betName: params.bet.getBetName() });\n          return placed;\n        },\n        canContinueOriginalPair: () => {\n          const row = current();\n          return row.submit === \"accepted\" && row.complete && !row.error && !gtcProgress.queryIssues[id]\n            && gtcUnits(row.matched) > 0n && row.deadlineAt > Date.now();\n        },\n        async confirm() {\n          // 首轮已在提交回执后核对；挂单无需等到终态，本轮收尾不停止后台监控。\n          const row = current(); const fact = summary().pm;\n          return { orders: [], rejected: fact.submission === \"rejected\", pendingConfirm: fact.fill !== \"full\" || Boolean(row.error) || Boolean(gtcProgress.queryIssues[id]) };\n        },\n        facts: () => summary().pm,\n        markConfirmed: () => markGtcLegOnce(current(), \"PM\"),",
      "          await notifyBet(account, pm, async () => { placed = await submitPmCore(); return summary(); }, gtcPmNotice, checked.waitSec, { matchTitle: params.match.title, betName: params.bet.getBetName() });\n          return placed;\n        },\n        async confirm() {\n          // [A8 可证实] 双腿发送后再核对；[changmen 扩展] GTC 挂单继续后台监控。\n          if (current().submit === \"accepted\") await pollGtc(id).catch(() => {});\n          const fact = summary().pm;\n          return { orders: [], rejected: fact.submission === \"rejected\", pendingConfirm: fact.fill !== \"full\" || Boolean(current().error) || Boolean(gtcProgress.queryIssues[id]) };\n        },\n        facts: () => summary().pm,\n        markConfirmed: () => markGtcLegOnce(current(), \"PM\"),"
    ],
    [
      "      [other, {\n        validate: validateOther,\n        async submit() {\n          validateOther(); await mutateGtc(id, { kind: \"authorize_other\" }); checkSession();\n          other.deferPostAcceptSettlement = true;\n          try {\n            const result = await placeOtherLeg(otherAccount, other, checked.linkId);\n            const unknown = result.pmSubmitUnknown || (!result.success && !result.response);\n            await mutateGtc(id, { kind: \"other\", state: unknown ? \"unknown\" : result.success ? \"accepted\" : \"rejected\", orderId: result.orderId ?? undefined, message: result.message ?? \"\" });\n            if (unknown) result.pmSubmitUnknown = true;\n            if (result.success) void pollGtcOther(id, false).catch(() => {});\n            return result;\n          }\n          catch (error) {\n            const message = error instanceof Error ? error.message : \"对侧提交结果未知\";\n            await mutateGtc(id, { kind: \"other\", state: \"unknown\", message });\n            const result = new BetResult(otherAccount.provider, false, message);\n            result.pmSubmitUnknown = true; result.link = checked.linkId; result.observation = other.observation;\n            return result;\n          }\n        },\n        // [changmen 扩展] 公共 place 已要求提交结果 success；监控提前推进 pending/filled 不撤销第二腿资格。\n        canContinueOriginalPair: () => !current().manual,\n        async confirm(result: BetResult) {\n          // [changmen 扩展] 原提交未知仍交给既有后台原单监控，不在首次收尾伪造受理事实。\n          if (!result.success)",
      "      [other, {\n        validate: validateOther,\n        async submit() {\n          let sent = false;\n          let received: BetResult | undefined;\n          try {\n            validateOther(); await mutateGtc(id, { kind: \"authorize_other\" }); checkSession();\n            other.deferPostAcceptSettlement = true;\n            sent = true;\n            const result = await submitOther();\n            received = result;\n            const unknown = result.pmSubmitUnknown || (!result.success && !result.response);\n            await mutateGtc(id, { kind: \"other\", state: unknown ? \"unknown\" : result.success ? \"accepted\" : \"rejected\", orderId: result.orderId ?? undefined, message: result.message ?? \"\" });\n            if (unknown) result.pmSubmitUnknown = true;\n            return result;\n          }\n          catch (error) {\n            if (received) return received;\n            return submissionFailure(\"OTHER\", error, sent);\n          }\n        },\n        async confirm(result: BetResult) {\n          // [changmen 扩展] 原提交未知仍交给既有后台原单监控，不在首次收尾伪造受理事实。\n          if (!result.success)"
    ]
  ]
};

// 每一项完整条件、正文、参数、上下文和出现次数均受保护；不按名字/模式批量删除。
export const UNIFIED_ARBITRAGE_BOUNDARIES = Object.freeze({
  [`${phases}prepareArbAttempt.ts`]: [
    ["const pmOrderMode = params.pmOrderMode === \"GTC\" && options.some(leg => leg.type === \"Polymarket\") ? \"GTC\" : undefined;", ""],
    ["if (pmOrderMode === \"GTC\" && (!betBothLegs || options.filter(leg => leg.type === \"Polymarket\").length !== 1)) { trace?.finish(\"skip\", \"PM GTC 当前只支持一条 PM 腿的双边套利\"); return null; }", ""],
    ["return { ...(pmOrderMode ? { pmOrderMode } : {}), legA,", "return { legA,"],
  ],
  [`${phases}checkArbLegs.ts`]: [
    ["  if (ready.pmOrderMode === \"GTC\" && [legA.type, legB.type].includes(\"Polymarket\")) {\n    try {\n      const { prepareGtcLegExecution } = await import(\"@/orderModes/gtc/arbLeg\");\n      ready.originalExecution = params.originalExecution = await prepareGtcLegExecution(params, {\n        ...ready, legA, legB, accountA, accountB, scanOddsA, scanOddsB,\n        precheckCompletedAt: performance.now(),\n        waitSec: arbBetToastSeconds(config, [accountA?.provider, accountB?.provider].filter(Boolean) as string[]),\n      });\n      for (const execution of ready.originalExecution.legs.values()) execution.validate();\n    }\n    catch (error) {\n      const reason = error instanceof Error ? error.message : \"GTC 发送准备失败\";\n      observeArbSubmissionBlocked({ ...ready, legA, legB }, \"pair_preparation_failed\", reason);\n      setMessage(reason); trace?.finish(\"fail\", reason); syncActiveBetFail(bet.id, reason);\n      return null;\n    }\n  }", ""],
    ["skipAccountRate: resolveSkipAccountRate(\"A\", ready), ...(legA.type === \"Polymarket\" && ready.pmOrderMode === \"GTC\" ? { pmOrderMode: ready.pmOrderMode } : {}),", "skipAccountRate: resolveSkipAccountRate(\"A\", ready),"],
    ["skipAccountRate: resolveSkipAccountRate(\"B\", ready), ...(legB.type === \"Polymarket\" && ready.pmOrderMode === \"GTC\" ? { pmOrderMode: ready.pmOrderMode } : {}),", "skipAccountRate: resolveSkipAccountRate(\"B\", ready),"],
  ],
  [`${phases}placeArbLegs.ts`]: [
    ["if (checked.pmOrderMode === \"GTC\" && hasPm && !original) { mixedBlocked = true; mixedBlockReason = \"GTC 发送准备未完成\"; }", ""],
    ["const original = checked.originalExecution;", ""],
    ["return original?.legs.get(leg)?.submit() ?? accountStore.betting(account, leg, waitSec, placeOpts);", "return accountStore.betting(account, leg, waitSec, placeOpts);"],
    ["const execution = original?.legs.get(leg); if (execution) { continue; }", ""],
    ["const tasks = [ submitLeg(accountA!, legA), submitLeg(accountB!, legB), ]; const pair = original ? (await Promise.allSettled(tasks)).map(row => row.status === \"fulfilled\" ? row.value : undefined) : await Promise.all(tasks);", "const pair = await Promise.all([ submitLeg(accountA!, legA), submitLeg(accountB!, legB), ]);"],
    ["if (original || resultA?.success || !pair.some(r => r?.success))", "if (resultA?.success || !pair.some(r => r?.success))"],
    ["original?.finishSubmission(); return buildPlaced(", "return buildPlaced("],
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
    ["export type CheckBettingOpts = ResolveVenueStakeOpts & { pmOrderMode?: \"FOK\" | \"GTC\"; pmGtcAllowResting?: boolean;", "export type CheckBettingOpts = ResolveVenueStakeOpts & {"],
    ["const checked = pm && opts?.pmOrderMode === \"GTC\" ? await (await import(\"@changmen/venue-adapter/polymarket/gtc\")).checkGtcBuy(account, option, signingTask, opts?.pmGtcAllowResting !== true) : await provider.checkBet(account, option, { role: opts?.role ?? \"execute\", prepareSigning: signingTask });", "const checked = await provider.checkBet(account, option, { role: opts?.role ?? \"execute\", prepareSigning: signingTask });"],
    // [changmen 扩展] 公共下单的旁路异常隔离、预检日志和冻结发送准备；逐段还原后仍比较整个固定基线模块。
    ["try { observeOption(option, account, \"submission_started\", { source: \"adapter_call\" }); } catch {}", "observeOption(option, account, \"submission_started\", { source: \"adapter_call\" });"],
    ["try { useMessageStore().delayMessage(account, Date.now() - beginTime); } catch {}", "useMessageStore().delayMessage(account, Date.now() - beginTime);"],
    ["try { result.saveLog(account, beginTime); } catch {}", "result.saveLog(account, beginTime);"],
    ["try { void playOrderSuccessSound({ betRowId: option.betId }).catch(() => {}); } catch {}", "void playOrderSuccessSound({ betRowId: option.betId });"],
    ["try { void publishBettingEvent(option).catch(() => {}); } catch {}", "void publishBettingEvent(option);"],
    ["let observedPrecheckResult = false; let checkedOption = option;", "let observedPrecheckResult = false;"],
    ["checkedOption = checked;", ""],
    ["try { checkedOption.saveLog(account); } catch {}", "option.saveLog(account);"],
    ["if (account.provider !== \"Polymarket\" && !opts?.requirePreparedQuote) await ensureSharedVaultKeyForAccount(account);", "if (account.provider !== \"Polymarket\") await ensureSharedVaultKeyForAccount(account);"],
    [
      `let accountLine = "", detailHtml = "";
       try {
         const platformLabel = store.getPlatformName(account.platformId, account.platformName);
         accountLine = bettingNotifyAccountLine(account, platformLabel);
         detailHtml = bettingDetailHtml({ matchTitle: option.match?.title, betName: option.bet?.getBetName(), target: option.target,
           itemOdds: option.item?.getOdds(option.target), betMoney: option.betMoney, odds: option.odds, betCount: option.betCount, });
       } catch {}`,
      `const platformLabel = store.getPlatformName(account.platformId, account.platformName);
       const accountLine = bettingNotifyAccountLine(account, platformLabel);
       const detailHtml = bettingDetailHtml({ matchTitle: option.match?.title, betName: option.bet?.getBetName(), target: option.target,
         itemOdds: option.item?.getOdds(option.target), betMoney: option.betMoney, odds: option.odds, betCount: option.betCount, });`,
    ],
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
  source = restoreGtcSelectionHistorySource(file, source, replaceExact, required);
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
  for (const [file, source] of Object.entries(contracts)) {
    let expected = source;
    if (file === "client/web/src/orderModes/gtc/arbLeg.ts") {
      for (const [before, after] of gtcClockCorrection) expected = replaceExact(expected, before, after);
    }
    for (const [before, after] of gtcInitialPairCorrection[file] ?? []) {
      assert.equal(expected.split(before).length, 2, `${file}: unique complete initial-pair correction`);
      expected = expected.replace(before, after);
    }
    if (file === "client/web/src/orderModes/gtc/arbLeg.ts") {
      // [changmen 扩展] 公共账号下单沿用该原腿的等待参数，原不可变契约不重写。
      expected = replaceExact(expected, "const submitOther = prepareOtherLeg(otherAccount, other, checked.linkId);", "const submitOther = prepareOtherLeg(otherAccount, other, checked.linkId, checked.waitSec);");
    }
    let actual;
    try { actual = restoreGtcSelectionHistorySource(file, readSource(file), replaceExact, true); }
    catch (error) { throw new Error(`${file}: complete reviewed unified capability contract: ${error.message}`); }
    assert.equal(restorePmOrderBetLabelSource(file, actual, readSource), expected, `${file}: complete reviewed unified capability contract`);
  }
  for (const file of Object.keys(UNIFIED_ARBITRAGE_BOUNDARIES)) {
    const restored = restoreRayFinalizeSource(file, restoreUnifiedArbitrageSource(file, readSource(file), replaceExact, true), replaceExact);
    assert.deepEqual(moduleTokens(restored), moduleTokens(gitSource("e901bb596952256284cd8a9eb8b73b572c963915", file)), `${file}: complete fixed-baseline module at pre-unification served source after exact restoration`);
  }
  return { completeCapabilityContracts: Object.keys(contracts).length, precisePublicModules: Object.keys(UNIFIED_ARBITRAGE_BOUNDARIES).length };
}
