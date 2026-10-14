import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseValidationArgs, validationPlan } from "./validation-plan.mjs";

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
const digest = value => createHash("sha256").update(value).digest("hex");
function inputs(root) {
  return Object.fromEntries([...new Set(split(git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")))].filter(code).sort()
    .map(file => {
      if (!fs.existsSync(path.join(root, file))) return [file, null];
      const bytes = fs.readFileSync(path.join(root, file));
      return [file, digest(binary(file) ? bytes : bytes.toString("utf8").replaceAll("\r\n", "\n"))];
    }));
}
export function validationCommands(plan, npm, releasePlan) {
  const cmd = (...args) => [process.execPath, npm, ...args];
  return {
    "complete-release": { command: cmd("run", "check:fok-release", "--", `--release-plan=${releasePlan}`) },
    "fok-551": { command: cmd("run", "check:fok-vps") },
    "validation-control": { command: cmd("exec", "--", "vitest", "run", "scripts/verification/validation-plan.test.mjs", "scripts/verification/verify-change.test.mjs", "server/storage/runtime_version.test.mjs", "server/backend/core/shared/runtime_version.test.mjs", "client/web/vite/plugins/runtimeVersion.test.ts", "--maxWorkers=4") },
    "boundaries": { command: cmd("run", "test:checks") },
    "router-compile": { command: cmd("run", "compile:router", "--workspace=@changmen/backend") },
    backend: { command: cmd("run", "test:backend", "--", "--force") },
    "frontend-typecheck": { command: cmd("run", "typecheck:frontend") },
    frontend: { command: cmd("exec", "--", "vitest", "run", "--maxWorkers=4"), cwd: "client/web" },
    build: { command: cmd("run", "app:build") },
  };
}
export function runChangeValidation(args, { run = spawnSync, npm = process.env.npm_execpath, cwd = process.cwd() } = {}) {
  const options = parseValidationArgs(args), plan = validationPlan(changedValidationPaths(options, cwd));
  if (options.planOnly) { console.log(JSON.stringify({ mode: "plan-only", accepted: false, ...plan }, null, 2)); return { passed: false, planOnly: true, plan }; }
  assert(npm, "Run with npm run check:change");
  if (options.staged) assertStagedSource(cwd);
  const before = inputs(cwd), commands = validationCommands(plan, npm, options.releasePlan), results = [];
  for (const check of plan.checks) {
    const selected = commands[check], started = Date.now();
    const result = run(selected.command[0], selected.command.slice(1), { cwd: selected.cwd ? path.resolve(cwd, selected.cwd) : cwd, stdio: "inherit", timeout: check === "complete-release" ? 30 * 60000 : 5 * 60000, windowsHide: true });
    results.push({ check, passed: result.status === 0, elapsedMs: Date.now() - started });
    if (result.status !== 0) break;
  }
  const sourceStable = JSON.stringify(inputs(cwd)) === JSON.stringify(before);
  const passed = results.length === plan.checks.length && results.every(row => row.passed) && sourceStable;
  const report = { checkedAt: new Date().toISOString(), passed, tier: plan.tier, paths: plan.paths, immutableFokEntries: 551, sourceStable,
    completeRelease: plan.tier === "full" && passed, results };
  fs.mkdirSync(path.join(cwd, "output/change-validation"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "output/change-validation/verdict.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runChangeValidation(process.argv.slice(2)); if (!result.planOnly && !result.passed) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
