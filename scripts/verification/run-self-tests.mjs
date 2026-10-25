import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { selectVerificationTests } from "./verification-selection.mjs";

export function runVerifierSelfTests(changed, { root = process.cwd(), npm = process.env.npm_execpath, run = spawnSync, select = selectVerificationTests, all = false } = {}) {
  if (!npm) throw Error("Run verifier self-tests through npm");
  const selection = all ? { inputs: changed, tests: [], historicalTests: [], reasons: [], all: true } : select(changed, { root });
  if (!all && !selection.tests.length && !selection.historicalTests.length) throw Error("No related verifier self-tests selected");
  console.log("[verification-selection] " + JSON.stringify(selection));
  fs.mkdirSync(path.join(root, "output/change-validation"), { recursive: true });
  fs.writeFileSync(path.join(root, "output/change-validation/verification-selection.json"), JSON.stringify(selection, null, 2));
  const batches = all ? [{ tests: ["scripts/verification"], historical: true }]
    : [{ tests: selection.tests, historical: false }, { tests: selection.historicalTests, historical: true }];
  const env = { ...process.env, npm_execpath: npm };
  // npm exec --call is also a convenient explicit entry; its call must not be
  // inherited as a second, conflicting invocation by the nested npm exec.
  delete env.npm_config_call;
  for (const batch of batches.filter(batch => batch.tests.length)) {
    const result = run(process.execPath, [npm, "exec", "--", "vitest", "run", ...batch.tests,
      "--exclude", "scripts/verification/fok-source-specialization.test.mjs", "--maxWorkers=2", "--testTimeout=15000"], {
      cwd: root, stdio: "inherit", windowsHide: true,
      env: { ...env, CHANGMEN_HISTORICAL_AUDIT: batch.historical ? "1" : "" },
    });
    if (result.status !== 0 || result.error) return { ...selection, passed: false };
  }
  if (all) {
    const result = run(process.execPath, ["--test", "scripts/verification/fok-source-specialization.test.mjs"], {
      cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, CHANGMEN_HISTORICAL_AUDIT: "1" },
    });
    if (result.status !== 0 || result.error) return { ...selection, passed: false };
  }
  return { ...selection, passed: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), all = args.length === 1 && args[0] === "--all";
  const result = runVerifierSelfTests(all ? args.slice(1) : args, { all });
  if (!result.passed) process.exitCode = 1;
}
