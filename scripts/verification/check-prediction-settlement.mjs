import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { settlementTests } from "./prediction-settlement-policy.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export function settlementPlan(root = repository) {
  const groups = [
    { name: "rulesAndPersistence", cwd: root, config: "scripts/verification/prediction-settlement-root.config.mjs" },
    { name: "browserAndDisplay", cwd: path.join(root, "client/web"), config: "scripts/verification/prediction-settlement-browser.config.mjs" },
  ].map(group => ({ ...group, tests: settlementTests[group.name] }));
  for (const file of groups.flatMap(group => [group.config, ...group.tests]))
    assert(fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile(), `Required settlement input missing: ${file}`);
  return groups;
}

export function checkPredictionSettlement({ root = repository, run = spawnSync } = {}) {
  const groups = settlementPlan(root);
  const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
  assert(fs.existsSync(vitest), "Install workspace dependencies first");
  const env = { ...process.env };
  delete env.npm_config_call;
  for (const group of groups) {
    console.log(`[prediction-settlement] ${group.name}: ${group.tests.length} required files`);
    const result = run(process.execPath, [vitest, "run", "--config", path.join(root, group.config), "--maxWorkers=2"],
      { cwd: group.cwd, env, stdio: "inherit", windowsHide: true });
    if (result.status !== 0 || result.error) return false;
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 1 && args[0] === "--plan"), "Only --plan is supported");
    if (args.length) console.log(JSON.stringify(settlementPlan(), null, 2));
    else if (!checkPredictionSettlement()) process.exitCode = 1;
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
