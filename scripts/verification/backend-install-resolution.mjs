// [changmen 扩展] Resolve literal reachable Node imports without executing services.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire, isBuiltin } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { componentImportSites } from "./component-entry-boundary.mjs";
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cjsResolution = site => site.kind === "require" || site.kind === "computed-loader" && site.loader !== "import.meta.resolve" && site.loader?.endsWith(".resolve");
const relative = (root, target) => {
  const value = path.relative(root, fs.realpathSync(target)).replaceAll("\\", "/");
  assert(!value.startsWith("../") && !path.isAbsolute(value), "Resolution escaped isolated installation"); return value;
};
export function captureBackendResolution(root, entries, env) {
  root = fs.realpathSync(root);
  const queue = entries.map(entry => `${entry.directory}/${entry.script}`), seen = new Set(), resolutions = [], unknown = [];
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
    const absolute = path.join(root, file);
    const sites = componentImportSites(file, fs.readFileSync(absolute, "utf8"));
    const selected = sites.filter(site => site.kind !== "type" && site.spec && !isBuiltin(site.spec));
    unknown.push(...sites.filter(site => site.kind !== "type" && !site.spec));
    const specs = [...new Set(selected.filter(site => !cjsResolution(site)).map(site => site.spec))];
    const esm = specs.length ? JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval",
      `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(specs)}.map(s=>{try{return[s,{id:import.meta.resolve(s)}]}catch(e){return[s,{error:e.code}]} }))))`],
    { cwd: path.dirname(absolute), env, encoding: "utf8", windowsHide: true, timeout: 15000 })) : {};
    for (const site of selected) {
      const row = { file, line: site.line, kind: site.kind, spec: site.spec };
      try {
        let target;
        if (cjsResolution(site)) target = createRequire(absolute).resolve(site.spec);
        else { assert(!esm[site.spec].error, esm[site.spec].error); target = fileURLToPath(esm[site.spec].id); }
        if (site.kind === "module-url" && fs.statSync(target).isDirectory()) {
          row.target = relative(root, target); row.assetType = "directory"; resolutions.push(row); continue;
        }
        assert(fs.statSync(target).isFile(), "Not a file");
        row.target = relative(root, target); row.sha256 = hash(target);
        if (!row.target.includes("node_modules/") && /\.[cm]?[jt]s$/.test(row.target)) queue.push(row.target);
        else if (row.target.includes("node_modules/")) {
          for (let dir = path.dirname(target); ; dir = path.dirname(dir)) {
            const manifest = path.join(dir, "package.json");
            if (fs.existsSync(manifest)) { const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")); row.package = pkg.name; row.version = pkg.version; break; }
            assert(dir !== root && dir !== path.dirname(dir), "Missing resolved package owner");
          }
        }
      } catch (error) { row.error = error.code ?? error.message; }
      resolutions.push(row);
    }
  }
  const key = row => JSON.stringify([row.file, row.line, row.kind, row.spec ?? row.expression]);
  resolutions.sort((a, b) => key(a).localeCompare(key(b))); unknown.sort((a, b) => key(a).localeCompare(key(b)));
  return { entries, files: [...seen].sort(), resolutions, unknown,
    unresolved: resolutions.filter(row => row.error), servicesExecuted: false };
}
export function assertBackendResolutionParity(baseline, candidate) {
  assert(baseline.resolutions.length > 0, "Missing resolution evidence");
  assert.deepEqual(baseline.unresolved, [], "Baseline contains unresolved literal runtime targets");
  assert.deepEqual(candidate, baseline, "Backend importer resolution/unknown evidence changed in selected installation");
}
