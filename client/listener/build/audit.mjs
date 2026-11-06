import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "vite";
import { assertIsolatedPaths, repoRoot, listenerRoot, reportsDir } from "./paths.mjs";

assertIsolatedPaths();
fs.mkdirSync(reportsDir, { recursive: true });
const command = process.argv[2];
const baselineFile = path.join(reportsDir, "audit-existing-baseline.json");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function snapshot() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
    }
  };
  visit(path.join(repoRoot, "client/web/dist"));
  for (const file of ["client/web/.env.local", "client/web/.env.development.local", "server/backend/.env"])
    if (fs.existsSync(path.join(repoRoot, file))) files.push(file);
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, fs.existsSync(path.join(repoRoot, file)) ? hash(path.join(repoRoot, file)) : "missing"]));
}
const write = (name, report) => {
  fs.writeFileSync(path.join(reportsDir, name), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
};
if (command === "capture") {
  const report = { capturedAt: new Date().toISOString(), files: snapshot() };
  fs.writeFileSync(baselineFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ capturedFiles: Object.keys(report.files).length }));
} else if (command === "verify") {
  const before = JSON.parse(fs.readFileSync(baselineFile, "utf8")).files;
  const after = snapshot();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
  const anchors = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/audits/LISTENER_ARBITRAGE_SOURCE_BASELINE_20261028.json"), "utf8")).files;
  const anchorChanges = anchors.filter(file => hash(path.join(repoRoot, file.path)) !== file.sha256).map(file => file.path);
  write("audit-existing-integrity.json", { passed: !changed.length && !anchorChanges.length, checkedFiles: Object.keys(before).length, changed, checkedAnchors: anchors.length, anchorChanges });
  if (changed.length || anchorChanges.length) process.exitCode = 1;
} else if (command === "legacy-graph") {
  let report;
  await build({
    root: path.join(repoRoot, "client/web"), configFile: path.join(repoRoot, "client/web/vite.config.ts"),
    logLevel: "warn", build: { write: false, emptyOutDir: false },
    plugins: [{ name: "listener-audit-legacy-entry", generateBundle(_options, bundle) {
      const modules = [...this.getModuleIds()].map(id => id.split("?")[0].replaceAll("\\", "/"));
      const listenerModules = modules.filter(id => id.startsWith(listenerRoot.replaceAll("\\", "/") + "/"));
      const has = suffix => modules.some(id => id.endsWith(suffix));
      const entries = Object.values(bundle).filter(item => item.type === "chunk" && item.isEntry).map(item => item.facadeModuleId);
      const html = Object.values(bundle).filter(item => item.type === "asset" && item.fileName.endsWith(".html")).map(item => item.fileName);
      report = { passed: !listenerModules.length && has("/client/web/src/main.ts") && has("/client/web/src/stores/match/mainBetLoop.ts") && has("/client/web/src/stores/betting/a8/runA8ArbRound.ts"),
        writesArtifacts: false, entries, html, listenerModules, moduleCount: modules.length,
        originalMain: has("/client/web/src/main.ts"), originalLoop: has("/client/web/src/stores/match/mainBetLoop.ts"), originalArbRound: has("/client/web/src/stores/betting/a8/runA8ArbRound.ts") };
    } }],
  });
  if (!report) throw new Error("Legacy build graph was not produced");
  write("audit-legacy-graph.json", report);
  if (!report.passed) process.exitCode = 1;
} else throw new Error("Use capture | verify | legacy-graph");
