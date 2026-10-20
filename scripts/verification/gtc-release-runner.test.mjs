// [changmen 扩展] 运行真实发布入口，隔离进程/VPS I/O，注入来源和组合故障。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import vm from "node:vm";
import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { releasePlan, selectGtcRelease } from "./gtc-independent-release.mjs";
import path from "node:path";
import { assertCaptureEvidence } from "./release-provenance.mjs";
import { FULL_AUDIT_PHASES, executionContext } from "../deploy/acceptance-contract.mjs";
function run({ args = ["--release-plan=backend-first"], change = () => {}, failPhase, errorPhase, changePublic = row => row, changeCapture = row => row, drift = false, ciCommit } = {}) {
  const artifacts = new Map(), plan = releasePlan(args), calls = [];
  const evidence = { captureId: "11111111-1111-1111-1111-111111111111", frontendVersion: "e901bb596952256284cd8a9eb8b73b572c963915", backendVersion: "832f3f76c30d6ad741ce850a68cd6ba1da7d06f9", immutableBaseline: "75b1efac66625e5f2bc9884a965b244bfaf337ed", findings: [] };
  const combinations = [{ id: "frontend-only", passed: false, failedBoundaries: ["gtc:manually-rebound-settled-buy"] },
    { id: "backend-only", passed: true, failedBoundaries: [] }, { id: "paired", passed: true, failedBoundaries: [] }];
  const selected = selectGtcRelease(plan, combinations);
  const compatibility = { ...evidence, combinations, release: selected, passed: selected.passed, frontendOnlyGtcCompatible: selected.frontendOnlyGtcCompatible };
  change(compatibility, evidence);
  const script = `const FULL_AUDIT_PHASES=${JSON.stringify(FULL_AUDIT_PHASES)};\n`
    + fs.readFileSync("scripts/verification/verify-fok-release.mjs", "utf8").replace(/^import .*;\r?\n/gm, "");
  const process = { env: { npm_execpath: "npm", ...(ciCommit ? { GITHUB_SHA: ciCommit } : {}) }, argv: ["node", "script", ...args], execPath: "node", cwd: () => "E:/candidate", stdout: { write() {} }, exitCode: 0 };
  let identityReads = 0;
  vm.runInNewContext(script, { assert, releasePlan, selectGtcRelease, process, Date, JSON, path, assertCaptureEvidence, executionContext, console: { log() {} },
    validationIdentity: () => ({ commit: "a".repeat(40), candidateTree: "b".repeat(40),
      inputFingerprint: (drift && identityReads++ > 0 ? "d" : "c").repeat(64) }),
    spawnSync: (_, command) => { calls.push(command); const name = command.join(" "); return { status: (failPhase && name.includes(failPhase)) || (name.includes("verify-gtc-backend-compatibility") && !compatibility.passed) ? 1 : 0,
      ...(errorPhase && name.includes(errorPhase) ? { error: { code: "ETIMEDOUT", message: "fixture timeout" } } : {}), stdout: "" }; },
    fs: { mkdirSync() {}, rmSync: file => artifacts.delete(file), writeFileSync: (path, value) => artifacts.set(path, value), existsSync: () => true,
      readFileSync: path => JSON.stringify(path.includes("gtc-backend-compatibility") ? compatibility
        : path.includes("vps-fok-release-verification") ? changeCapture({ ...evidence, passed: true })
        : path.includes("fok-public-entry-comparison") ? changePublic({ ...evidence }) : evidence) },
  });
  return { report: JSON.parse(artifacts.get("output/fok-release-verdict.json")), exitCode: process.exitCode, calls };
}
it("real full entry accepts only an explicit backend-first plan and keeps frontend-only blocked in the verdict", () => {
  const result = run(); expect(result.exitCode).toBe(0);
  expect(result.report).toMatchObject({ passed: true, releasePlan: "backend-first", frontendOnlyGtcCompatible: false, deploymentOrder: ["backend", "frontend"] });
  expect(result.calls.some(args => args.includes("--release-plan=backend-first"))).toBe(true);
});
it("full entry binds identity, rejects input drift and refuses a different CI checkout", () => {
  const accepted = run(); expect(accepted.report.sourceStable).toBe(true);
  expect(accepted.report.identity.commit).toBe("a".repeat(40));
  expect(accepted.report.results.map(row => row.phase)).toEqual(FULL_AUDIT_PHASES);
  const changed = run({ drift: true }); expect(changed.exitCode).toBe(1); expect(changed.report.sourceStable).toBe(false);
  expect(changed.report.passed).toBe(false);
  expect(() => run({ ciCommit: "e".repeat(40) })).toThrow("differs from CI checkout");
});
it("real default full entry remains FAIL for new frontend and captured old backend", () => {
  const result = run({ args: [] }); expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ passed: false, releasePlan: "frontend-only", frontendOnlyGtcCompatible: false });
  expect(result.report.failedBoundaries).toContain("gtc:manually-rebound-settled-buy");
});
it.each([
  data => { data.captureId = "stale"; },
  data => { data.frontendVersion = "backend-client-copy"; },
  data => { data.backendVersion = "frontend-commit"; },
  data => { data.release.plan = "frontend-only"; },
  data => { data.combinations.pop(); },
  data => { data.combinations[2].passed = false; data.combinations[2].failedBoundaries = ["exact lookup failed"]; },
  data => { data.release.frontendOnlyGtcCompatible = true; },
  data => { data.frontendOnlyGtcCompatible = true; },
])("real full entry rejects stale, mislabeled or inconsistent compatibility evidence %o", change => {
  const result = run({ change }); expect(result.exitCode).toBe(1); expect(result.report.passed).toBe(false);
  expect(result.report.failedBoundaries).toContain("gtc:missing-current-release-evidence");
});
it.each(["verify-fok-public-entries", "check:fok-vps", "test:checks", "app:build", "verify-fok-release-stability"])("backend-first never bypasses a failed protection/build/stability stage %s", failPhase => {
  const result = run({ failPhase }); expect(result.exitCode).toBe(1); expect(result.report.passed).toBe(false);
});
it("rejects public entry evidence from another capture", () => expect(() => run({ changePublic: row => ({ ...row, captureId: "stale" }) })).toThrow("fresh evidence mismatch"));
it("rejects an unsuccessful capture even when other mocked phases pass", () => expect(() => run({ changeCapture: row => ({ ...row, passed: false }) })).toThrow());
it.each(["capture-vps-fok-baseline", "audit-fok-release-files"])("stops at failed provenance %s and cannot reuse old release evidence", failPhase => {
  const result = run({ failPhase });
  expect(result.report.passed).toBe(false);
  expect(result.calls.some(command => command.includes("--release-plan=backend-first"))).toBe(false);
});
it.each(["verify-gtc-backend-compatibility", "turbo", "app:build"])("stops immediately at a failed required stage %s", failPhase => {
  const result = run({ failPhase });
  expect(result.report.passed).toBe(false);
  expect(result.report.results.at(-1).passed).toBe(false);
  expect(result.calls.at(-1).join(" ")).toContain(failPhase);
  expect(result.calls.some(command => command.join(" ").includes("verify-fok-release-stability"))).toBe(false);
});
it("full audit records actual commands and treats a zero-status timeout as a failed execution", () => {
  const success = run();
  expect(success.calls.filter(args => args.includes("test:checks"))).toHaveLength(1);
  expect(success.calls.filter(args => args.includes("check:fok-vps"))).toHaveLength(1);
  expect(success.report.results.find(row => row.phase === "backend").execution.command).toEqual([
    "node", "npm", "exec", "--", "turbo", "run", "test", "--filter=./server/**...", "--force",
  ]);
  expect(success.report.results.find(row => row.phase === "frontend")).toMatchObject({
    exitCode: 0, errorCode: null, signal: null,
    execution: { command: ["node", "npm", "exec", "--", "vitest", "run", "--maxWorkers=2", "--reporter=json", "--outputFile=../../output/orders-phase2-protection/frontend.json"], cwd: "client/web" },
  });
  const failed = run({ errorPhase: "turbo" });
  expect(failed.exitCode).toBe(1);
  expect(failed.report.results.at(-1)).toMatchObject({ phase: "backend", passed: false, exitCode: 0, errorCode: "ETIMEDOUT" });
});
