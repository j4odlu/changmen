#!/usr/bin/env node
/**
 * 运行各平台 CLI：{platform}/scripts/<scriptName>
 * 用法：node scripts/platform-cli.mjs <platformDir> <scriptName> [-- extra args…]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(__dirname, "..");

const [platformDir, scriptName, ...rest] = process.argv.slice(2);
if (!platformDir || !scriptName) {
  console.error("usage: platform-cli.mjs <platformDir> <scriptName> [-- args…]");
  process.exit(1);
}

const scriptPath = path.join(PKG_ROOT, platformDir, "scripts", scriptName);
if (!fs.existsSync(scriptPath)) {
  console.error(`platform script not found: ${platformDir}/scripts/${scriptName}`);
  process.exit(1);
}

const extra = rest[0] === "--" ? rest.slice(1) : rest;
const result = spawnSync(process.execPath, [scriptPath, ...extra], {
  stdio: "inherit",
  cwd: PKG_ROOT,
});
process.exit(result.status ?? 1);
