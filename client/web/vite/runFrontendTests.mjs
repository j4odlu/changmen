import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const args = process.argv.slice(2);
for (const [cwd, config] of [
  [new URL("../", import.meta.url), []],
  [new URL("../../../", import.meta.url), ["--config", "client/listener/build/vite.live.config.ts"]],
  [new URL("../../../", import.meta.url), ["--config", "client/listener/build/vite.compat.config.ts"]],
]) {
  const result = spawnSync(process.execPath, [vitest, "run", ...config, ...args], { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
