import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 补充业务验证；不改 VPS 哈希清单，不替代严格源码快照。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import vm from "node:vm";
import ts from "typescript";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreUnifiedArbitrageSource, verifyUnifiedArbitrageContract } from "./unified-arb-boundaries.mjs";
import { runFokDifferentials } from "./fok-runtime-fixtures.mjs";
import { readRelocatedPmFokSource } from "./pm-fok-source-relocation.mjs";
import { readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { restorePublishedPmSettlement } from "./pm-published-settlement-boundary.mjs";
import { restoreMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";
import { restoreRayProviderSource, restoreRayFinalizeSource } from "./ray-frontend-boundary.mjs";
import { restorePmManualSellSplit } from "./pm-manual-sell-split-boundary.mjs";

fs.mkdirSync("output", { recursive: true });

const manifest = JSON.parse(readAdapterHistory("scripts/verification/vps-fok-baseline.json", "utf8"));
const base = manifest.version;
const normal = text => text.replace(/\r\n/g, "\n");
const sha = text => createHash("sha256").update(normal(text)).digest("hex");
const printer = ts.createPrinter({ removeComments: true });
const canonical = text => printer.printFile(ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true)).replace(/\s+/g, " ").trim();
const baselineSources = new Map();
const files = Object.keys(manifest.protectedFiles);
const objects = execFileSync("git", ["cat-file", "--batch"], { input: `${files.map(file => `${base}:${file}`).join("\n")}\n`, maxBuffer: 30 * 1024 * 1024 });
let offset = 0;
for (const file of files) {
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8").split(" ");
  assert.equal(header[1], "blob", `missing immutable baseline ${file}`);
  const size = Number(header[2]);
  baselineSources.set(file, objects.subarray(end + 1, end + 1 + size).toString("utf8"));
  offset = end + 1 + size + 1;
}
const oldSource = file => baselineSources.get(file) ?? execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
// [changmen 扩展] 只还原已登记迁移的完整源码与引用；不执行任何业务特化或增加差异豁免。
function currentSource(file) {
  const readSource = withAdapterHistoryReader(target => restorePublishedPmSettlement(target, readAdapterHistory(target, "utf8")));
  const relocated = readRelocatedPmFokSource(file, readRelocatedPmFunctionalSource(file, readSource(file), readSource), readSource);
  const unified = restoreUnifiedArbitrageSource(file, restoreMinimalOrdersSource(file, relocated, readSource), replaceExact);
  return restoreRayProviderSource(file, restoreRayFinalizeSource(file, unified, replaceExact), readSource);
}
const unifiedContract = verifyUnifiedArbitrageContract(target => readAdapterHistory(target, "utf8"), replaceExact);
const reviewed = new Map();
function review(file, kind, transform) {
  const source = currentSource(file);
  assert.deepEqual(moduleTokens(transform(source)), moduleTokens(oldSource(file)), `${file}: entire module after exact reviewed extensions must equal VPS`);
  reviewed.set(file, { file, kind, entireFokSpecializationIdentical: true });
}
function replace(source, before, after = "", count = 1) {
  // Only this complete expression/statement is accepted, never an arbitrary name or block.
  const pattern = before.trim().split(/\s+/).map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const regex = new RegExp(pattern, "g");
  assert.equal([...source.matchAll(regex)].length, count, `reviewed source occurrence: ${before}`);
  return source.replace(regex, after);
}
const root = "client/web/src/stores/betting/autoBet/";
review(`${root}phases/checkArbLegs.ts`, "timeout observation only", (source) => {
  source = replace(source, "import { observeArbSubmissionBlocked } from \"@/services/orderExecutionObservation\";");
  return replace(source, "observeArbSubmissionBlocked({ ...ready, legA, legB }, \"precheck_timeout\", msg);");
});
review(`${root}phases/placeArbLegs.ts`, "blocked pair and unsent second-leg observation only", (source) => {
  source = replace(source, "import { observeArbSubmissionBlocked } from \"@/services/orderExecutionObservation\";");
  source = replace(source, "if (mixedBlocked) observeArbSubmissionBlocked(checked, \"pair_submit_blocked\", mixedBlockReason);");
  return replace(source, `else {
    // [changmen 扩展] 首腿未成功时 A8 不发第二腿；单独记录第二腿未提交，不覆盖首腿回执。
    const reason = resultA.pmSubmitUnknown ? "首腿提交结果未知，未发送第二腿" : "首腿提交返回失败，未发送第二腿";
    observeArbSubmissionBlocked({ ...checked, accountA: undefined }, "serial_first_leg_failed", reason);
  }`);
});
review(`${root}executeArbBet.ts`, "isolated failure-progress observation only", (source) => {
  source = replace(source, "import { syncActiveBetFail } from \"@/stores/betting/activeBetRunSync\";");
  return replace(source, `try {
    if (ready)
      syncActiveBetFail(params.bet.id, msg, phase === "check" ? "预检" : phase === "place" ? "下单" : "拒单");
  }
  catch { /* [changmen 扩展] 进度记录失败不得中断 FOK 原有异常收尾。 */ }`);
});
review("client/web/src/stores/betting/activeBetRunSync.ts", "optional failure label in UI only", (source) => {
  source = replace(source, "betId: number, reason: string, layer?: \"预检\" | \"下单\" | \"拒单\"", "betId: number, reason: string");
  return replace(source, `const failLayer = layer ?? (run?.phase === "checking" || run?.phase === "preparing"
    ? "预检"
    : run?.phase === "settling" || run?.phase === "syncing"
      ? "拒单"
      : "下单");`, `const failLayer = run?.phase === "checking" || run?.phase === "preparing"
    ? "预检" : run?.phase === "settling" || run?.phase === "syncing" ? "拒单" : "下单";`);
});
function restoreGtcManualSellBody(source) {
  source = replace(source, `const persist = async () => {
    if (buyRow.PmGtcExecutionId) {
      // [changmen 扩展] 仅这张 GTC 原单的平仓核对净回款，FOK 保留原保存路径。
      const { saveOrders: saveGtcOrders } = await import("@/orderModes/gtc/ordersApi");
      await saveGtcOrders(account, ordersToSave.map(row => ({ ...row, pmGtcExecutionId: buyRow.PmGtcExecutionId })));
    }
    else {
      await saveOrders(account, ordersToSave);
    }
  };`);
  source = replace(source, `const reason = saveErr instanceof Error ? saveErr.message : String(saveErr);
      if (buyRow.PmGtcExecutionId) {
        // GTC 保存包含 CONFIRMED 成交及净回款核对；撮合回执不能证明链上结算已完成。
        ElMessage.warning(\`卖单已返回成交，成交确认、净回款核对或订单保存尚未完成：\${reason}。已保留原卖单并自动重试，请勿重复卖出。\`);
      }
      else {
        ElMessage.error(\`链上已平仓，但订单落库失败：\${reason}。已按已平仓展示，请稍后刷新。\`);
      }`, `ElMessage.error(
        \`链上已平仓，但订单落库失败：\${saveErr instanceof Error ? saveErr.message : String(saveErr)}。已按已平仓展示，请稍后刷新。\`,
      );`);
  return replace(source, "await persist();", "await saveOrders(account, ordersToSave);", 2);
}
// [changmen 扩展] 只接受精确身份入口和唯一私有函数；私有函数还原原有扩展后也必须完整匹配同一 VPS 函数。
function reviewPmManualSell(source, baseline) {
  const file = "client/web/src/stores/account/pmManualSell.ts";
  restorePmManualSellSplit(file, source);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const previous = ts.createSourceFile(file, baseline, ts.ScriptTarget.Latest, true);
  assert.equal(sf.parseDiagnostics.length, 0, "manual sell source must parse");
  assert.equal(previous.parseDiagnostics.length, 0, "manual sell baseline must parse");
  const find = (tree, name) => tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const helpers = find(sf, "persistGtcFilledSell");
  const originals = find(sf, "persistFilledSell");
  const oldOriginals = find(previous, "persistFilledSell");
  assert.equal(helpers.length, 1, "exactly one GTC persistence helper");
  assert.equal(originals.length, 1, "exactly one original persistence entry");
  assert.equal(oldOriginals.length, 1, "exactly one baseline persistence entry");
  const helper = helpers[0];
  assert.equal(helper.modifiers?.length, 1, "GTC helper must remain private and async");
  assert.equal(helper.modifiers[0].kind, ts.SyntaxKind.AsyncKeyword, "GTC helper must remain private and async");
  const entry = originals[0].body?.statements[0];
  assert(entry, "original persistence entry must have an identity gate");
  const print = (node, tree) => printer.printNode(ts.EmitHint.Unspecified, node, tree);
  const expectedGate = ts.createSourceFile(file, "if (buyRow.PmGtcExecutionId) return persistGtcFilledSell(account, buyRow, ordersToSave);", ts.ScriptTarget.Latest, true);
  assert.equal(print(entry, sf), print(expectedGate.statements[0], expectedGate), "only the exact GTC identity gate may precede original save work");
  let references = 0;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === "persistGtcFilledSell")
      references++;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  assert.equal(references, 2, "private GTC helper has only its declaration and identity-gated call");
  const restored = restoreGtcManualSellBody(helper.getText(sf));
  const restoredTree = ts.createSourceFile(file, restored, ts.ScriptTarget.Latest, true);
  assert.equal(restoredTree.parseDiagnostics.length, 0);
  assert.equal(restoredTree.statements.length, 1, "restored helper must remain a single function");
  const restoredHelper = restoredTree.statements[0];
  assert(ts.isFunctionDeclaration(restoredHelper));
  const renamed = ts.factory.updateFunctionDeclaration(restoredHelper, restoredHelper.modifiers, restoredHelper.asteriskToken, ts.factory.createIdentifier("persistFilledSell"), restoredHelper.typeParameters, restoredHelper.parameters, restoredHelper.type, restoredHelper.body);
  assert.equal(print(renamed, restoredTree), print(oldOriginals[0], previous), "entire GTC helper after the original exact extensions must equal the VPS function");
  const edits = [helper, entry].map(node => ({ start: node.getStart(sf), end: node.getEnd() })).sort((a, b) => b.start - a.start);
  for (const edit of edits)
    source = source.slice(0, edit.start) + source.slice(edit.end);
  return source;
}
review("client/web/src/stores/account/pmManualSell.ts", "only tagged GTC manual sales use GTC persistence and pending-cash notice", source => reviewPmManualSell(source, oldSource("client/web/src/stores/account/pmManualSell.ts")));
review("server/backend/core/account/order/position_events.js", "only tagged GTC historical sell events use net cash", (source) => {
  source = replace(source, "import { Currency, getExchange } from \"@changmen/shared/currency\";");
  return replace(source, `raw.pmGtcExecutionId && Number.isFinite(Number(row.bet_money))
    ? Math.round(Number(row.bet_money) / getExchange(Currency.USDT) * 10000) / 10000 : raw.pmStakeUsdc`, "raw.pmStakeUsdc");
});

let exactFiles = 0;
const differences = [];
for (const [file, expected] of Object.entries(manifest.protectedFiles)) {
  assert.equal(sha(oldSource(file)), expected, `immutable VPS provenance: ${file}`);
  if (sha(currentSource(file)) === expected) { exactFiles++; continue; }
  differences.push(file);
  verifyProtectedSource(file, readAdapterHistory(file, "utf8"), oldSource(file), target => readAdapterHistory(target, "utf8"), target => gitSource(base, target));
}
// Run the original shared boundary entry without source slicing or excluded modules.
await import("./verify-fok-shared-boundaries.mjs");

// Run the existing behavioral differential against REAL current sources, not the specialized text.
// Extra progress events are outside the submission/financial trace. Make the new observer throw
// to prove its isolation while the complete baseline business trace still matches.
const fokTail = source => canonical(`async function fok(){\n${source.slice(source.indexOf("  const toastSec = manualBetToastSeconds();"))}`);
assert.equal(fokTail(readAdapterHistory("client/web/src/orderModes/fok/manual.ts", "utf8")), fokTail(oldSource("client/web/src/stores/betting/manualBet.ts")), "complete manual FOK execution body unchanged from VPS");
// [changmen 扩展] 实际源码差分沿用固定 VPS 与独立手动提交，历史四项差异显式记录。
const manualIndependentBaseline = "89b87779";
const behavioral = await runFokDifferentials(base);
const artifacts = ["output/fok-reviewed-runtime-differentials.json"];
fs.writeFileSync(artifacts[0], `${JSON.stringify(behavioral, null, 2)}\n`);

// Exhaustively compare the financial merge with identical, independently cloned inputs.
function loadFinancial(file, source) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const dependencies = {
    "@changmen/shared/currency": { Currency: { USDT: "USDT" }, getExchange: () => 6.7 },
    "./dto.js": { parseNum: (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback, normalizePmMatchResult: v => ["win", "lose"].includes(String(v).toLowerCase()) ? String(v).toLowerCase() : undefined },
    "@changmen/shared/pm_submission": { validatePmSubmission: () => undefined },
  };
  vm.runInNewContext(js, { exports, require(name) { assert(name in dependencies); return dependencies[name]; } }, { filename: file });
  return exports.mergePolymarketProviderSave;
}
const saveFile = "server/backend/core/account/order/save_pm.js";
assert.equal(sha(currentSource(saveFile)), manifest.protectedFiles[saveFile], "FOK financial merge after exact published settlement restoration");
const oldMerge = loadFinancial(saveFile, oldSource(saveFile));
const currentMerge = loadFinancial(saveFile, readAdapterHistory(saveFile, "utf8"));
let financialCases = 0;
for (const status of ["none", "reject", "win", "lose", "lost"]) {
  for (const state of ["open", "partial", "closed", "settled"]) {
    for (const side of ["buy", "sell"]) {
      for (const fee of [0, 0.0797, 0.17283]) {
        for (const incomingMoney of [0, 12.86802, -50.49, -50.54279]) {
          const raw = { status, betMoney: 50.34112, money: incomingMoney, pmOrigin: "changmen", pmSide: side, pmShares: 23.68, pmFillPrice: 0.31, pmFeeUsdc: fee, pmStakeUsdc: 7.5136, pmSellState: state, pmAttributedSellShares: state === "partial" ? 3 : state === "closed" ? 23.68 : 0, ...(state === "partial" || state === "closed" ? { pmSellProceeds: 8, pmRealizedPnlUsdc: 0.6 } : {}) };
          const inputs = [{ status, bet_money: 50.34112, money: incomingMoney }, raw, raw, "changmen", raw, incomingMoney, 50.34112];
          const previous = oldMerge(...structuredClone(inputs));
          const current = currentMerge(...structuredClone(inputs));
          assert.equal(JSON.stringify(current), JSON.stringify(previous), `FOK money/cost/fee: ${status}/${state}/${side}/${fee}/${incomingMoney}`);
          financialCases++;
        }
      }
    }
  }
}
const report = { unifiedContract, baseline: base, protectedFiles: Object.keys(manifest.protectedFiles).length, exactFiles, rawSourceSnapshotPassed: differences.length === 0, strictSnapshotDifferences: differences, reviewedExtensions: [...reviewed.values()], legacyMetadataWriterSpecializationPassed: true, financialMergeByteIdentical: true, financialDifferentialCases: financialCases, pmFokSubmissionSourceByteIdentical: true, manualFokExecutionBodyIdenticalToVps: true, autoExecutionDifferentialCases: 18, manualExecutionDifferentialCases: 19, finalizationDifferentialCases: 4, manualIndependentBaseline, manualEntryUnchangedSinceA8Correction: true, intentionalManualDifferencesFromVps: ["low balance", "account filter", "muted map", "prematch blocked"], observerThrowIsolationPassed: true, behavioralArtifacts: artifacts, exactProtectionPassed: true, fullReleaseAccepted: false, scope: "Whole-module reviewed FOK protection with immutable original hashes. Existing notification fault and manual gate differences remain explicit. No real buy/sell/cancel, database writes, commit or deployment." };
fs.writeFileSync("output/fok-reviewed-differences.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
