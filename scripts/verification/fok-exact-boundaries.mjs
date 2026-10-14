// [changmen 扩展] 逐项完整保护已审查差异；不改变基线，也不提供按名字/前缀剥离的通用豁免。
import assert from "node:assert/strict";
import { restoreUnifiedArbitrageSource } from "./unified-arb-boundaries.mjs";
import { restoreRayBackendDispatch } from "./ray-backend-dispatch-boundary.mjs";
import { restoreRayProviderSource, restoreRayFinalizeSource } from "./ray-frontend-boundary.mjs";
import { restoreRayOrderSyncSource } from "./ray-client-monitor-boundary.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ts from "typescript";
import { checkOrdinaryOrderView } from "./fok-order-view-fixture.mjs";
import { specializeFokSource } from "./fok-source-specialization.mjs";
import { restoreOrdersConsumerCompatibility } from "./orders-consumer-boundary.mjs";
import { restoreMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";
import { restoreGtcSnapshotMetadata } from "./pm-manual-sell-split-boundary.mjs";

export const notificationCommit = "23f2846bee1ff0a91811f49f9a5d5ac2d78fccdf";
const root = "client/web/src/stores/betting/autoBet/";
const normalize = text => text.replace(/\r\n/g, "\n");
const printer = ts.createPrinter({ removeComments: true });
const cache = new Map();
export function gitSource(base, file) {
  const key = `${base}:${file}`;
  if (!cache.has(key))
    cache.set(key, normalize(execFileSync("git", ["show", key], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 })));
  return cache.get(key);
}
function tokens(source) {
  // 所有受保护文件都是模块；片段也用相同模块上下文解析 await，位置仍指向原文本。
  const prefix = "export {};\n";
  const tree = ts.createSourceFile("tokens.ts", prefix + source, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if (ts.isJSDoc(node))
      return;
    const children = node.getChildren(tree);
    if (children.length)
      children.forEach(visit);
    else if (node.getWidth(tree) > 0 && node.getStart(tree) >= prefix.length)
      result.push({ kind: node.kind, text: node.getText(tree), start: node.getStart(tree) - prefix.length, end: node.getEnd() - prefix.length });
  }
  visit(tree);
  return result;
}
export function moduleTokens(source) {
  const tree = ts.createSourceFile("protected.ts", source, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, "protected module must parse");
  return tokens(printer.printFile(tree)).map(token => [token.kind, token.text]);
}
// 精确 token 序列保留字符串内部空白；仅忽略语法外的格式和注释。
export function replaceExact(source, before, after = "") {
  const haystack = tokens(source); const needle = tokens(before);
  assert(needle.length > 0);
  const matches = [];
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    if (needle.every((token, offset) => token.kind === haystack[index + offset].kind && token.text === haystack[index + offset].text))
      matches.push(index);
  }
  assert.equal(matches.length, 1, `exact boundary occurrence: ${before}`);
  const index = matches[0];
  return source.slice(0, haystack[index].start) + after + source.slice(haystack[index + needle.length - 1].end);
}
function sameModule(current, original, file) {
  assert.deepEqual(moduleTokens(current), moduleTokens(original), `${file}: complete fixed-baseline module`);
}
const observerFile = "client/web/src/services/orderExecutionObservation.ts";
function checkObserver(readSource, baselineRead) {
  let source = readSource(observerFile);
  source = replaceExact(source, "import { createObservationContext, observeOrder, observeOption } from \"./orderObservation\";", "import { createObservationContext, observeOrder } from \"./orderObservation\";");
  source = replaceExact(source, `export function observeArbSubmissionBlocked(ready: ArbBetReady, reasonCode: string, message: string): void {
    try {
      const evidence = observationFailureEvidence(message);
      for (const [leg, account] of [[ready.legA, ready.accountA], [ready.legB, ready.accountB]] as const) {
        if (account)
          observeOption(leg, account, "submission_result", { ...evidence,
            outcome: "not_submitted", source: "orchestration", reasonCode: evidence.reasonCode || reasonCode,
            safeSummary: evidence.errorCategory === "unclassified" ? "双腿提交前校验未通过，整对未提交" : evidence.safeSummary });
      }
    }
    catch {}
  }`);
  sameModule(source, baselineRead(observerFile), observerFile);
}
function restoreGateway(source) {
  source = replaceExact(source, "import { showBetResultNotification, startBetNotification } from \"@/shared/betNotification\";", "import { ElNotification } from \"element-plus\";");
  source = replaceExact(source, `import { bettingDetailHtml, bettingNotifyAccountLine, } from "@/shared/a8Notify";`, `import { bettingDetailHtml, bettingLoadingMessageHtml, bettingNotifyAccountLine, bettingResultMessageHtml, } from "@/shared/a8Notify";`);
  source = replaceExact(source, `const notificationDisplay = { provider: account.provider, accountLine, detailHtml };
    const loading = startBetNotification(notificationDisplay);
    const beginTime = Date.now();`, `const loading = ElNotification({
      title: "", message: bettingLoadingMessageHtml(account.provider, accountLine, detailHtml),
      dangerouslyUseHTMLString: true, duration: 10_000, customClass: \`notification loading \${account.provider}\`,
    });
    const beginTime = Date.now();`);
  source = replaceExact(source, `loading.close();
    const notifyType = result.pending ? "warning" : result.success ? "success" : "error";
    const statusSuffix = result.pending ? "确认中" : "";
    showBetResultNotification(notificationDisplay, { messageHtml: \`<p>\${result.message || ""}</p>\`, statusSuffix, type: notifyType, }, toastSeconds);
    useMessageStore().delayMessage(account, Date.now() - beginTime);`, `loading.close();
    const notifyType = result.pending ? "warning" : result.success ? "success" : "error";
    const statusSuffix = result.pending ? "确认中" : "";
    ElNotification({ title: "", message: bettingResultMessageHtml(account.provider, accountLine, detailHtml, \`<p>\${result.message || ""}</p>\`, statusSuffix),
      type: notifyType, dangerouslyUseHTMLString: true, customClass: \`notification \${account.provider}\`, duration: toastSeconds === 0 ? 3000 : toastSeconds * 1000, });
    useMessageStore().delayMessage(account, Date.now() - beginTime);`);
  return replaceExact(source, `const titleSuffix = rejected ? "未成交" : "已成交";
    showBetResultNotification({ provider: account.provider, accountLine: task.accountLine, detailHtml: task.detailHtml }, {
      messageHtml: \`<p>\${result.message || ""}</p>\`, statusSuffix: titleSuffix, type: rejected ? "error" : "success",
    }, task.toastSeconds);
    if (!rejected && !task.recoveryOnly)`, `const titleSuffix = rejected ? "未成交" : "已成交";
    ElNotification({ title: "", message: bettingResultMessageHtml(account.provider, task.accountLine, task.detailHtml, \`<p>\${result.message || ""}</p>\`, titleSuffix),
      type: rejected ? "error" : "success", dangerouslyUseHTMLString: true, duration: task.toastSeconds === 0 ? 3000 : task.toastSeconds * 1000, customClass: \`notification \${account.provider}\`, });
    if (!rejected && !task.recoveryOnly)`);
}

export function verifyProtectedSource(file, current, original, readSource = target => fs.readFileSync(target, "utf8"), baselineRead) {
  const specialized = specializeFokSource(file, restoreMinimalOrdersSource(file, current, readSource), readSource);
  const unified = restoreRayOrderSyncSource(file, restoreUnifiedArbitrageSource(file, specialized, replaceExact), readSource, replaceExact);
  const source = restoreRayBackendDispatch(file, restoreRayProviderSource(file, restoreRayFinalizeSource(file, unified, replaceExact), readSource), replaceExact);
  const unifiedRestored = source !== specialized;
  if (file === "server/db/rds/orders_store.js") {
    sameModule(restoreOrdersConsumerCompatibility(source, readSource), original, file);
    return { file, fixedSourceEqual: false, exactBoundaryVerified: true, kind: "explicit orders financial compatibility with complete fixed-baseline module" };
  }
  if (source === normalize(original))
    return { file, fixedSourceEqual: !unifiedRestored, exactBoundaryVerified: unifiedRestored, ...(unifiedRestored ? { kind: "precise unified increments with complete fixed-baseline module" } : {}) };
  let restored = source;
  if (file === "server/backend/core/account/order_store.js") {
    for (const [name, module] of [["preserveOrderMode", "orderMetadata"], ["saveRowsByExecution", "saveRows"]]) {
      restored = replaceExact(restored, `import { ${name} } from "../orderModes/${module}.js";`);
      const helper = `server/backend/core/orderModes/${module}.js`;
      assert.equal(normalize(module === "orderMetadata" ? restoreGtcSnapshotMetadata(readSource(helper)) : readSource(helper)), gitSource("4dd2c5e967fbd2101e3c848f2d48c221ec7c4e72", helper), "complete existing committed mode helper");
    }
    restored = replaceExact(restored, "preserveOrderMode(raw, prevRaw, o, existingByOrderId);");
    restored = replaceExact(restored, "if (rows.some(row => row.raw?.pmGtcExecutionId)) return saveRowsByExecution(rows);");
    sameModule(restored, original, file);
    return { file, fixedSourceEqual: false, exactBoundaryVerified: true, kind: "complete original shared writer and exact committed mode dispatch" };
  }
  if (file === "client/web/src/stores/account/pmManualSell.ts") {
    sameModule(source, original, file);
    return { file, fixedSourceEqual: false, exactBoundaryVerified: true, kind: "exact published identity dispatch with complete original manual persistence module" };
  }
  if (file === "client/web/src/components/order/OrderView.vue") {
    checkOrdinaryOrderView(current, original);
    return { file, fixedSourceEqual: false, exactBoundaryVerified: true, kind: "optional read-only projection and slot" };
  }
  else if (file === `${root}phases/checkArbLegs.ts`) {
    checkObserver(readSource, baselineRead);
    restored = replaceExact(restored, "import { observeArbSubmissionBlocked } from \"@/services/orderExecutionObservation\";");
    restored = replaceExact(restored, `if (config.checkTimeout && Date.now() - checkStart > config.checkTimeout) {
      const elapsed = Date.now() - checkStart;
      const msg = \`超时时间：\${elapsed}ms，大于设定值：\${config.checkTimeout}ms\`;
      observeArbSubmissionBlocked({ ...ready, legA, legB }, "precheck_timeout", msg);
      setMessage(\`前置检查超时 \${elapsed}ms\`);`, `if (config.checkTimeout && Date.now() - checkStart > config.checkTimeout) {
      const elapsed = Date.now() - checkStart;
      const msg = \`超时时间：\${elapsed}ms，大于设定值：\${config.checkTimeout}ms\`;
      setMessage(\`前置检查超时 \${elapsed}ms\`);`);
  }
  else if (file === `${root}phases/placeArbLegs.ts`) {
    checkObserver(readSource, baselineRead);
    restored = replaceExact(restored, "import { observeArbSubmissionBlocked } from \"@/services/orderExecutionObservation\";");
    restored = replaceExact(restored, `if (mixedBlocked) observeArbSubmissionBlocked(checked, "pair_submit_blocked", mixedBlockReason);
      if (!mixedBlocked && !betBothLegs)`, "if (!mixedBlocked && !betBothLegs)");
    restored = replaceExact(restored, `attemptedB = true;
      resultB = await submitLeg(accountB!, legB);
    } else {
      const reason = resultA.pmSubmitUnknown ? "首腿提交结果未知，未发送第二腿" : "首腿提交返回失败，未发送第二腿";
      observeArbSubmissionBlocked({ ...checked, accountA: undefined }, "serial_first_leg_failed", reason);
    }`, `attemptedB = true;
      resultB = await submitLeg(accountB!, legB);
    }`);
  }
  else if (file === `${root}executeArbBet.ts`) {
    restored = replaceExact(restored, "import { syncActiveBetFail } from \"@/stores/betting/activeBetRunSync\";");
    restored = replaceExact(restored, `params.setMessage(\`自动下单异常：\${msg}\`);
      try { if (ready) syncActiveBetFail(params.bet.id, msg, phase === "check" ? "预检" : phase === "place" ? "下单" : "拒单"); } catch {}
      attempt.trace?.finish("fail", msg);`, `params.setMessage(\`自动下单异常：\${msg}\`); attempt.trace?.finish("fail", msg);`);
  }
  else if (file === "client/web/src/stores/betting/activeBetRunSync.ts") {
    restored = replaceExact(restored, "export function syncActiveBetFail(betId: number, reason: string, layer?: \"预检\" | \"下单\" | \"拒单\")", "export function syncActiveBetFail(betId: number, reason: string)");
    restored = replaceExact(restored, `const failLayer = layer ?? (run?.phase === "checking" || run?.phase === "preparing" ? "预检" : run?.phase === "settling" || run?.phase === "syncing" ? "拒单" : "下单");`, "const failLayer = run?.phase === \"checking\" || run?.phase === \"preparing\" ? \"预检\" : run?.phase === \"settling\" || run?.phase === \"syncing\" ? \"拒单\" : \"下单\";");
  }
  else if (file === "server/backend/core/account/order/position_events.js") {
    restored = replaceExact(restored, "import { Currency, getExchange } from \"@changmen/shared/currency\";");
    restored = replaceExact(restored, `price: raw.pmFillPrice,
      proceeds: raw.pmGtcExecutionId && Number.isFinite(Number(row.bet_money)) ? Math.round(Number(row.bet_money) / getExchange(Currency.USDT) * 10000) / 10000 : raw.pmStakeUsdc,
      pnl: raw.pmRealizedPnlUsdc,`, "price: raw.pmFillPrice, proceeds: raw.pmStakeUsdc, pnl: raw.pmRealizedPnlUsdc,");
  }
  else if (file === "client/web/src/stores/account/betGateway.ts") {
    const helper = "client/web/src/shared/betNotification.ts";
    assert.equal(normalize(readSource(helper)), gitSource(notificationCommit, helper), "complete notification isolation helper must retain its independent committed implementation");
    restored = restoreGateway(restored);
    // Imports 的声明顺序调整单独还原，不能删除或修改其他依赖。
    restored = replaceExact(restored, "import { ElNotification } from \"element-plus\";");
    restored = replaceExact(restored, "import { attachPolymarketDetectionQuote } from \"@/domain/polymarket/attachDetectionQuote\";", "import { ElNotification } from \"element-plus\"; import { attachPolymarketDetectionQuote } from \"@/domain/polymarket/attachDetectionQuote\";");
  }
  else if (unifiedRestored) {
    // 只经过登记增量的模块仍须在下方全文对照同一个原基线。
  }
  else {
    assert.fail(`${file}: unregistered protected source difference`);
  }
  sameModule(restored, original, file);
  return { file, fixedSourceEqual: false, exactBoundaryVerified: true };
}

// [changmen 扩展] 保护既有独立提交移除的手动筛选门控；仍从原基线逐句验证，不替换原基线。
export function manualBaselineAfterKnownCorrection(source) {
  let restored = replaceExact(source, "const matchStore = useMatchStore();");
  restored = replaceExact(restored, "if (isMapMuteActive(match.id, bet.round, match.liveRound) || !isPrematchFullMarketAllowed(match, bet)) return;");
  restored = replaceExact(restored, `if (!accountPassesMainBetFilter(account, bet, match, option, matchStore)) {
    await ElMessageBox.alert(\`当前 \${item.type} 账号不满足买入条件\`, "提示"); return;
  }`);
  return replaceExact(restored, `const bal = account.getBalance(); if (bal !== undefined && bal < amount) {
    await ElMessageBox.alert(\`余额不足（\${bal} < \${amount}）\`, String(item.type)); return;
  }`);
}
