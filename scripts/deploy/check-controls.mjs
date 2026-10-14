/** [changmen 扩展] Offline publication controls share one entry on Windows and CI. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const tests = fs.readdirSync("scripts/deploy").filter(file => file.endsWith(".test.mjs")).map(file => `scripts/deploy/${file}`);
const node = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit", windowsHide: true });
if (node.status !== 0) process.exit(node.status ?? 1);
const bash = process.platform === "win32" ? "C:/msys64/usr/bin/bash.exe" : "bash";
const shell = spawnSync(bash, ["scripts/deploy/release.test.sh"], { stdio: "inherit", windowsHide: true,
  env: { ...process.env, ...(process.platform === "win32" ? { MSYS: "winsymlinks:nativestrict" } : {}) } });
process.exitCode = shell.status ?? 1;
