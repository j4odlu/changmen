import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseSummary } from "./release-summary.mjs";
test("missing reports, changed commits and failed jobs never read as a publication pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-summary-"));
  const save = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  try {
    assert.match(releaseSummary({ root }), /未产生验收报告/);
    const identity = { commit: "a".repeat(40), inputFingerprint: "b".repeat(64) };
    const report = { identity, passed: true, sourceStable: true, immutableFokEntries: 551, planFingerprint: "c".repeat(64), results: [],
      plan: { requiredChecks: { completeRelease: false, databaseCompatibility: false }, deployment: { scope: "frontend" } } };
    save("output/change-validation/verdict.json", report);
    assert.match(releaseSummary({ root }), /未取得.*封包证据/);
    save("output/release-validation/evidence.json", { commit: identity.commit, inputFingerprint: identity.inputFingerprint, planFingerprint: report.planFingerprint });
    assert.match(releaseSummary({ root, commit: identity.commit, status: "success" }), /通过，发布仍受后续任务控制/);
    for (const args of [{ commit: "f".repeat(40) }, { status: "failure" }, { status: "cancelled" }])
      assert.match(releaseSummary({ root, ...args }), /未通过，不能据此放行/);
    report.plan.requiredChecks.databaseCompatibility = true; save("output/change-validation/verdict.json", report);
    assert.match(releaseSummary({ root }), /database: 缺失/);
    save("output/database-compatibility/verdict.json", { passed: false, results: [{ phase: "history-schema", passed: false, exitCode: 23 }] });
    assert.match(releaseSummary({ root }), /database\/history-schema.*23/);
  } finally { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); }
});
