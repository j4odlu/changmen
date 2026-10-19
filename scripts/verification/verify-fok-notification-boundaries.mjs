import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 真实 POST/通知故障保护；保留既有异常隔离，旧基线差异必须显式匹配。
import assert from "node:assert/strict";
import fs from "node:fs";
import { gitSource, notificationCommit, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { gateway } from "./fok-notification-fixture.mjs";

function business(row) {
  return { result: row.result, error: row.error, queued: row.queued.map(({ accountLine: _line, detailHtml: _html, ...task }) => task), trace: row.trace.filter(event => !["loading", "close", "result_notice"].includes(event)) };
}
const file = "client/web/src/stores/account/betGateway.ts";
const baselines = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
for (const base of baselines)
  verifyProtectedSource(file, readAdapterHistory(file, "utf8"), gitSource(base, file));
const cases = [];
for (const base of [...baselines, notificationCommit]) {
  for (const provider of ["OB", "RAY", "Polymarket"]) {
    for (const outcome of ["accepted", "rejected", "throw", "pending"]) {
      const normal = await gateway(null, provider, null, { outcome });
      for (const failure of [null, "loading", "close", "result", "format"]) {
        const previous = await gateway(base, provider, failure, { outcome });
        const current = await gateway(null, provider, failure, { outcome });
        const equal = JSON.stringify(previous) === JSON.stringify(current);
        // [changmen 扩展] 已审查的展示准备异常隔离；旧异常零发送、新版只发送原单一次。
        if (failure === "format") {
          assert.equal(previous.error, "UI unavailable");
          assert.equal(previous.trace.filter(event => event.bet).length, 0);
          assert.equal(equal, false);
        }
        else assert.equal(equal, base === notificationCommit || !failure, `${base}/${provider}/${outcome}/${failure}`);
        assert.deepEqual(business(current), business(normal), "notification faults must preserve actual business trace");
        assert.equal(current.trace.filter(event => event.bet).length, 1, "exactly one POST");
        cases.push({ base, provider, outcome, failure, equal, previous, current });
      }
    }
  }
}
const confirmations = [];
for (const confirmation of ["filled", "rejected", "pending", "throw"]) {
  const normal = await gateway(null, "RAY", null, { outcome: "pending", confirmation });
  for (const failure of [null, "loading", "close", "result", "terminal"]) {
    const current = await gateway(null, "RAY", failure, { outcome: "pending", confirmation });
    assert.deepEqual(business(current), business(normal), "confirmation result notice cannot interrupt marking or balance refresh");
    assert.equal(current.trace.filter(event => event.bet).length, 1);
    assert.equal(current.trace.filter(event => event === "confirm_read").length, 1);
    assert.equal(current.trace.filter(event => event === "mark").length, confirmation === "filled" ? 1 : 0);
    assert.equal(current.trace.filter(event => event === "balance").length, ["filled", "rejected"].includes(confirmation) ? 1 : 0);
    confirmations.push({ confirmation, failure, current });
  }
}
const guards = [];
for (const provider of ["OB", "RAY", "Polymarket"]) {
  for (const failure of [null, "loading", "close", "result", "format"]) {
    const unprepared = await gateway(null, provider, failure, { unprepared: true });
    assert.equal(unprepared.trace.filter(event => event.bet).length, 0);
    assert.equal(unprepared.queued.length, 0);
    for (const flag of ["loseOrder", "deferPostAcceptSettlement"]) {
      const current = await gateway(null, provider, failure, { outcome: "pending", [flag]: true });
      assert.equal(current.trace.filter(event => event.bet).length, 1);
      assert.equal(current.queued.length, 0);
      guards.push({ provider, failure, flag, current });
    }
    guards.push({ provider, failure, unprepared });
  }
}
fs.mkdirSync("output", { recursive: true });
const report = { passed: true, fullReleaseAccepted: false, baselines, notificationCommit, comparisons: cases.length, historicalDifferences: cases.filter(row => !row.equal).length, confirmationFaultCases: confirmations.length, originalGateCases: guards.length, cases, confirmations, guards, scope: "Real gateway/helper modules with simulated venue, POST, persistence and confirmation. No live I/O, retries, commit or deployment." };
fs.writeFileSync("output/fok-notification-boundaries.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed: report.passed, comparisons: report.comparisons, historicalDifferences: report.historicalDifferences, confirmationFaultCases: report.confirmationFaultCases, originalGateCases: report.originalGateCases, fullReleaseAccepted: false })}\n`);
