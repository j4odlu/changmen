import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { presentationTests } from "./presentation-policy.mjs";
import { assertPresentationBoundaries } from "./presentation-boundary.mjs";

export function checkPresentation({ root = process.cwd(), npm = process.env.npm_execpath, run = spawnSync } = {}) {
  assert(npm, "Run through npm/check:change");
  assertPresentationBoundaries(root);
  const env = { ...process.env, npm_execpath: npm };
  delete env.npm_config_call;
  const result = run(process.execPath, [npm, "exec", "--", "vitest", "run",
    ...presentationTests.map(file => file.slice("client/web/".length)), "--maxWorkers=2"],
  { cwd: path.join(root, "client/web"), env, stdio: "inherit", windowsHide: true });
  return result.status === 0 && !result.error;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!checkPresentation()) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
