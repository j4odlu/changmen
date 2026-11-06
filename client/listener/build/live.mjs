import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { loadEnv } from "vite";
import { resolveDevWebPort } from "@changmen/runtime-tooling/dev_web_port.js";
import { assertIsolatedPaths, repoRoot, reportsDir, outputDir } from "./paths.mjs";
assertIsolatedPaths();
const command = process.argv[2] ?? "check";
if (!["check", "build", "typecheck", "test", "compat"].includes(command)) throw new Error("Use check | build | typecheck | test | compat");
const localBase = `/@fs/${outputDir.replaceAll("\\", "/")}/`;
const webPort = resolveDevWebPort({ ...loadEnv("development", path.join(repoRoot, "client/web"), ""), ...process.env });
const target = `http://127.0.0.1:${webPort}/listener/`;
const snapshot = () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).split("\0").filter(file => file && !file.startsWith("client/listener/"));
  const visit = directory => { if (fs.existsSync(directory)) for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) visit(file); else if (item.isFile()) files.push(path.relative(repoRoot, file)); } };
  visit(path.join(repoRoot, "client/web/dist"));
  return Object.fromEntries(files.map(file => [file, fs.existsSync(path.join(repoRoot, file)) ? createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex") : "missing"]));
};
const before = snapshot();
const checks = [];
const run = (name, binary, args) => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules", binary), ...args], { cwd: repoRoot, stdio: "inherit", windowsHide: true });
  checks.push({ name, passed: result.status === 0 && !result.error });
  if (result.error || result.status !== 0) throw new Error(`${name} failed`);
};
let failure;
try {
  if (["check", "build", "typecheck"].includes(command)) {
    run("live-types", "vue-tsc/bin/vue-tsc.js", ["--noEmit", "-p", "client/listener/build/tsconfig.live.json"]);
    run("live-build-types", "typescript/bin/tsc", ["--project", "client/listener/build/tsconfig.node.json"]);
  }
  if (["check", "test"].includes(command)) run("live-tests", "vitest/vitest.mjs", ["run", "--config", "client/listener/build/vite.live.config.ts", "--maxWorkers=2"]);
  if (command === "compat") run("shared-execution-compat", "vitest/vitest.mjs", ["run", "--config", "client/listener/build/vite.compat.config.ts", "--maxWorkers=2"]);
  if (["check", "build"].includes(command)) run("live-build", "vite/bin/vite.js", ["build", "--config", "client/listener/build/vite.live.config.ts", "--mode", "development", "--base", localBase]);
} catch (error) { failure = error; }
finally {
  const after = snapshot();
  const changedExistingFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
  const report = { stage: "listener-integrated", command, passed: !failure && !changedExistingFiles.length, checks, preservedFiles: Object.keys(before).length, changedExistingFiles, target };
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, `live-${command}-isolation.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (changedExistingFiles.length) failure = new Error("Existing files changed: " + changedExistingFiles.join(", "));
}
if (failure) throw failure;
