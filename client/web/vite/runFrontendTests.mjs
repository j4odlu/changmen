import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

// A full invocation still runs all three suites. In CI only the web suite is
// sharded; the first shard runs both small listener suites without a shard flag.
export function frontendTestRuns(args = []) {
  let shard;
  const listenerArgs = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--shard" || arg.startsWith("--shard=")) {
      if (shard !== undefined) throw Error("Duplicate frontend shard");
      shard = arg === "--shard" ? args[++index] : arg.slice("--shard=".length);
      if (typeof shard !== "string" || !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw Error("Invalid frontend shard");
      const [part, total] = shard.split("/").map(Number);
      if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part > total) throw Error("Invalid frontend shard");
    } else listenerArgs.push(arg);
  }
  const runs = [{ suite: "web", cwd: fileURLToPath(new URL("../", import.meta.url)), args: ["run", ...args] }];
  if (shard === undefined || shard.startsWith("1/")) {
    for (const suite of ["live", "compat"]) runs.push({ suite: `listener-${suite}`,
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      args: ["run", "--config", `client/listener/build/vite.${suite}.config.ts`, ...listenerArgs] });
  }
  return runs;
}
export function runFrontendTests(args, { run = spawnSync } = {}) {
  for (const invocation of frontendTestRuns(args)) {
    const result = run(process.execPath, [vitest, ...invocation.args], { cwd: invocation.cwd, env: process.env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runFrontendTests(process.argv.slice(2));
