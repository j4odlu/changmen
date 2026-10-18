import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { parseValidationArgs } from "./validation-plan.mjs";
import { changePlan, eventSelection, planHash } from "../deploy/change-plan.mjs";
import { FULL_CHECK_COVERAGE, executionContext, proofHash, assertSupplemental } from "../deploy/acceptance-contract.mjs";

const binary = file => /\.(?:png|jpe?g|webp|gif|woff2?)$/.test(file);
const code = file => /\.(?:[cm]?js|tsx?|vue|json|ya?ml|sh|sql|toml|css|scss|less|html|svg|png|jpe?g|webp|gif|woff2?)$/.test(file)
  && !/^(?:docs|output|\.ai|\.claude|\.playwright-cli)\//.test(file);
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 40 * 1024 * 1024, windowsHide: true });
const split = output => output.split("\0").filter(Boolean);
export function changedValidationPaths(options, root = process.cwd()) {
  if (options.staged) return split(git(root, "diff", "--cached", "--no-renames", "--name-only", "-z"));
  const pending = [...split(git(root, "diff", "HEAD", "--no-renames", "--name-only", "-z")), ...split(git(root, "ls-files", "--others", "--exclude-standard", "-z"))];
  if (options.base) {
    const base = git(root, "rev-parse", "--verify", "--end-of-options", `${options.base}^{commit}`).trim();
    return [...split(git(root, "diff", "--no-renames", "--name-only", "-z", base, "HEAD")), ...pending];
  }
  if (pending.length) return pending;
  try { return split(git(root, "diff", "--no-renames", "--name-only", "-z", "HEAD^", "HEAD")); }
  catch { return split(git(root, "ls-files", "-z")); }
}
export function assertStagedSource(root = process.cwd()) {
  // 测试读工作区，不能把不在候选中的另一份代码当作本次验收对象。
  const unstaged = [...split(git(root, "diff", "--no-renames", "--name-only", "-z")), ...split(git(root, "ls-files", "--others", "--exclude-standard", "-z"))].filter(code);
  assert.equal(unstaged.length, 0, "Unstaged source would contaminate staged validation; use a clean candidate checkout");
}
export function assertCommittedSource(root = process.cwd()) {
  const pending = [...split(git(root, "diff", "HEAD", "--no-renames", "--name-only", "-z")),
    ...split(git(root, "ls-files", "--others", "--exclude-standard", "-z"))].filter(code);
  assert.equal(pending.length, 0, "Uncommitted source cannot represent a HEAD release archive");
}
const digest = value => createHash("sha256").update(value).digest("hex");
export function validationInputs(root) {
  return Object.fromEntries([...new Set(split(git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")))].filter(code).sort()
    .map(file => {
      if (!fs.existsSync(path.join(root, file))) return [file, null];
      const bytes = fs.readFileSync(path.join(root, file));
      return [file, digest(binary(file) ? bytes : bytes.toString("utf8").replaceAll("\r\n", "\n"))];
    }));
}
export function validationIdentity(root, inputs = validationInputs(root)) {
  return { commit: git(root, "rev-parse", "HEAD").trim(), candidateTree: git(root, "rev-parse", "HEAD^{tree}").trim(),
    inputFingerprint: digest(JSON.stringify(inputs)) };
}
export function validationCommands(plan, npm, releasePlan) {
  const cmd = (...args) => [process.execPath, npm, ...args];
  return {
    "deployment-control": { command: [process.execPath, "scripts/deploy/check-controls.mjs"] },
    "complete-release": { command: [process.execPath, "scripts/verification/verify-fok-release.mjs", `--release-plan=${releasePlan}`] },
    "database-compatibility": { command: [process.execPath, "scripts/deploy/check-database-compatibility.mjs"] },
    "fok-551": { command: cmd("run", "check:fok-vps") },
    "verification-control": { command: cmd("exec", "--", "vitest", "run", "scripts/verification", "--exclude", "scripts/verification/fok-source-specialization.test.mjs", "--maxWorkers=4") },
    "verification-node": { command: [process.execPath, "--test", "scripts/verification/fok-source-specialization.test.mjs"] },
    "validation-control": { command: cmd("exec", "--", "vitest", "run", "scripts/verification/validation-plan.test.mjs", "scripts/verification/verify-change.test.mjs", "server/storage/runtime_version.test.mjs", "server/backend/core/shared/runtime_version.test.mjs", "client/web/vite/plugins/runtimeVersion.test.ts", "--maxWorkers=4") },
    "boundaries": { command: cmd("run", "test:checks") },
    "router-compile": { command: cmd("run", "compile:router", "--workspace=@changmen/backend") },
    backend: { command: cmd("run", "test:backend", "--", "--force") },
    "frontend-typecheck": { command: cmd("run", "typecheck:frontend") },
    frontend: { command: cmd("exec", "--", "vitest", "run", "--maxWorkers=2"), cwd: "client/web" },
    build: { command: cmd("run", "app:build") },
  };
}
export function executeValidationChecks(plan, { run = spawnSync, npm, cwd, identity }) {
  const commands = validationCommands(plan, npm, plan.releasePlan), results = [], invocationId = randomUUID();
  // Direct Node invocation keeps exactly this environment in the full-audit child.
  const env = { ...process.env, npm_execpath: npm, CHANGMEN_ACCEPTANCE_INVOCATION: invocationId };
  const context = executionContext(env), executionOrder = [];
  const acceptance = { plan, identity, invocationId, context, results };
  const order = plan.checks.includes("complete-release")
    ? [...plan.checks.filter(check => !FULL_CHECK_COVERAGE[check] && !["complete-release", "database-compatibility"].includes(check)),
      "complete-release", ...plan.checks.filter(check => FULL_CHECK_COVERAGE[check] || check === "database-compatibility")]
    : plan.checks;
  let full = null;
  const reportFile = path.join(cwd, "output/fok-release-verdict.json");
  if (plan.checks.includes("complete-release")) fs.rmSync(reportFile, { force: true });
  for (const check of order) {
    const selected = commands[check], started = Date.now();
    const execution = { command: selected.command, cwd: selected.cwd ?? "." };
    let row;
    try {
      if (full && FULL_CHECK_COVERAGE[check]) {
        assert.deepEqual(validationIdentity(cwd), identity, "Inputs changed before reuse");
        assert.equal(proofHash(JSON.parse(fs.readFileSync(reportFile, "utf8"))), proofHash(full), "Full report changed before reuse");
        row = { check, passed: true, elapsedMs: 0, exitCode: 0, errorCode: null, signal: null, execution,
          reusedFrom: { kind: "full", phase: FULL_CHECK_COVERAGE[check], reportHash: proofHash(full), invocationId } };
        assertSupplemental(full, "full", { ...acceptance, results: [row] });
      } else {
        executionOrder.push(check);
        const result = run(selected.command[0], selected.command.slice(1), { cwd: selected.cwd ? path.resolve(cwd, selected.cwd) : cwd,
          stdio: "inherit", env, timeout: check === "complete-release" ? 30 * 60000 : check === "database-compatibility" ? 15 * 60000 : 5 * 60000, windowsHide: true });
        row = { check, passed: result.status === 0 && !result.error, elapsedMs: Date.now() - started,
          exitCode: result.status, errorCode: result.error?.code ?? null, signal: result.signal ?? null, execution };
        if (check === "complete-release" && row.passed) {
          full = JSON.parse(fs.readFileSync(reportFile, "utf8"));
          assert.equal(full.invocationId, invocationId, "Full report belongs to another invocation");
          assert.deepEqual(full.context, context, "Full audit execution environment differs");
          assertSupplemental(full, "full", acceptance);
        }
      }
    } catch (error) {
      row = { check, passed: false, elapsedMs: Date.now() - started, exitCode: null, errorCode: "ACCEPTANCE_EVIDENCE_INVALID", signal: null, diagnostic: error.message, execution };
    }
    results.push(row);
    if (!row.passed) break;
  }
  results.sort((a, b) => plan.checks.indexOf(a.check) - plan.checks.indexOf(b.check));
  return { results, invocationId, context, executionOrder };
}
export function runChangeValidation(args, { run = spawnSync, npm = process.env.npm_execpath, cwd = process.cwd() } = {}) {
  const options = parseValidationArgs(args);
  const selection = options.event
    ? eventSelection(JSON.parse(fs.readFileSync(path.resolve(cwd, options.event), "utf8")), cwd, process.env.GITHUB_SHA,
      process.env.CI_DEPLOYED_VERSIONS_FILE ? JSON.parse(fs.readFileSync(path.resolve(cwd, process.env.CI_DEPLOYED_VERSIONS_FILE), "utf8")) : null)
    : { paths: changedValidationPaths(options, cwd), requestedScope: options.publish, unknownBase: false };
  const plan = changePlan(selection.paths, { ...selection, purpose: options.event || options.publish ? "release" : "change" });
  if (args.some(arg => arg.startsWith("--release-plan=")) && options.releasePlan !== plan.releasePlan)
    throw Error("Release plan conflicts with publication dependencies");
  if (options.planOnly) { console.log(JSON.stringify({ mode: "plan-only", accepted: false, ...plan }, null, 2)); return { passed: false, planOnly: true, plan }; }
  assert(npm, "Run with npm run check:change");
  if (options.staged) assertStagedSource(cwd);
  if (options.publish || options.event) assertCommittedSource(cwd);
  const before = validationInputs(cwd);
  const identity = { commit: options.staged ? null : git(cwd, "rev-parse", "HEAD").trim(),
    candidateTree: git(cwd, options.staged ? "write-tree" : "rev-parse", ...(options.staged ? [] : ["HEAD^{tree}"])).trim(),
    inputFingerprint: digest(JSON.stringify(before)) };
  const execution = executeValidationChecks(plan, { run, npm, cwd, identity });
  const { results } = execution;
  const sourceStable = JSON.stringify(validationInputs(cwd)) === JSON.stringify(before);
  const passed = results.length === plan.checks.length && results.every(row => row.passed) && sourceStable;
  const report = { checkedAt: new Date().toISOString(), passed, tier: plan.tier, paths: plan.paths, immutableFokEntries: 551, sourceStable,
    completeRelease: plan.checks.includes("complete-release") && passed, ...execution, identity, plan, planFingerprint: planHash(plan) };
  fs.mkdirSync(path.join(cwd, "output/change-validation"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "output/change-validation/verdict.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runChangeValidation(process.argv.slice(2)); if (!result.planOnly && !result.passed) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
