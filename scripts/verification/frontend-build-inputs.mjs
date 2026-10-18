// [changmen 扩展] Check build source ownership and the serving asset contract without running Vite/backend.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { restoreRuntimeCoverageSource } from "./runtime-source-coverage.mjs";
const normalize = text => text.replaceAll("\r\n", "\n");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function inspectFrontendBuildInputs(root, { readFile = file => fs.readFileSync(path.join(root, file)) } = {}) {
  const text = file => normalize(readFile(file).toString("utf8"));
  const policy = JSON.parse(text("scripts/verification/frontend-build-inputs.json")), violations = [];
  if (policy.schemaVersion !== 1 || policy.purpose !== "frontend-build-source-isolation-only" || policy.publishScopeOptimizationEnabled !== false)
    throw Error("Invalid frontend build source policy");
  const fail = (file, pattern) => violations.push({ rule: "frontend-build-input", file, line: 0, spec: "build contract", pattern });
  for (const [file, expected] of [["devtools/runtime-tooling/runtime_version.js", policy.canonicalRuntimeSha256],
    ["devtools/runtime-tooling/dev_web_port.js", policy.canonicalPortSha256]]) {
    try {
      const source = file.endsWith("runtime_version.js") ? restoreRuntimeCoverageSource(text(file)) : text(file);
      if (hash(source) !== expected) fail(file, "Complete original shared implementation must remain unchanged");
    } catch { fail(file, "Only the registered coverage addition may precede complete original source verification"); }
  }
  for (const name of ["runtime_version.js", "runtime_version.d.ts", "dev_web_port.js", "dev_web_port.d.ts"]) {
    const file = `packages/shared/tooling/${name}`;
    const entry = '// [changmen 扩展] 旧 Node 工具导出兼容；宿主显式提供 runtime-tooling。\n'
      + `export * from "@changmen/runtime-tooling/${name.replace(".d.ts", ".js")}";\n`;
    if (text(file) !== entry) fail(file, "Legacy tooling exports must only forward to the single Node workspace");
  }
  const wrapper = '// [changmen 扩展] 保留旧 Node 入口；完整来源识别实现位于独立 Node 工具包。\nexport * from "@changmen/runtime-tooling/runtime_version.js";\n';
  if (text("server/storage/runtime_version.js") !== wrapper) fail("server/storage/runtime_version.js", "Old source identity entry must only re-export the same canonical module");
  const portSource = text("devtools/runtime-tooling/dev_web_port.js");
  const devConfig = text("server/storage/dev_web_config.js")
    .replace('import { resolveDevWebPort } from "@changmen/runtime-tooling/dev_web_port.js";\n', "")
    .replace('export { resolveDevWebPort } from "@changmen/runtime-tooling/dev_web_port.js";\n', portSource.trimEnd() + "\n");
  if (hash(devConfig) !== policy.originalDevConfigSha256) fail("server/storage/dev_web_config.js", "Complete original environment loading and port semantics must restore exactly");
  const shared = JSON.parse(text("packages/shared/package.json"));
  for (const name of ["runtime_version", "dev_web_port"])
    if (shared.exports?.[`./tooling/${name}.js`] !== `./tooling/${name}.js`) fail("packages/shared/package.json", `Shared Node tooling export changed: ${name}`);
  const ownership = JSON.parse(text("scripts/verification/source-ownership-inputs.json"));
  if (policy.activeBuildRoots.some(file => !ownership.toolingRoots?.includes(file) || !ownership.roots.includes(file)))
    fail("scripts/verification/source-ownership-inputs.json", "Every active frontend build input must remain a scoped ownership seed");
  const components = JSON.parse(text("scripts/deploy/component-inputs.json"));
  if (!components.nodeOnlyPaths.includes("packages/shared/tooling")) fail("scripts/deploy/component-inputs.json", "Shared Node tooling must remain forbidden to browser runtime consumers");
  if (!components.nodeOnlyPaths.includes("devtools/runtime-tooling")) fail("scripts/deploy/component-inputs.json", "Canonical Node tooling must remain forbidden to browser runtime consumers");
  const contract = JSON.parse(text(policy.assetContract)), prefix = "/esport2/assets/";
  if (contract.schemaVersion !== 1 || contract.prefix !== prefix || contract.owner !== "backend-public-contract" || !contract.assets || !Object.keys(contract.assets).length)
    throw Error("Invalid legacy public asset contract");
  const references = new Set(), unknown = [];
  function scan(directory) {
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${item.name}`;
      if (item.isDirectory()) scan(file);
      else if (/\.(?:css|vue|[cm]?js|ts)$/.test(file) && !/\.(?:test|spec)\./.test(file)) {
        for (const match of text(file).matchAll(/\/esport2\/assets\/([^\s"'`()<>,;]+)/g)) {
          const name = match[1].split(/[?#]/)[0];
          if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) unknown.push({ file, source: match[0] });
          else references.add(prefix + name);
        }
      }
    }
  }
  scan("client/web/src");
  for (const item of unknown) fail(item.file, `Unknown/computed legacy asset URL requires review: ${item.source}`);
  const registered = Object.keys(contract.assets).sort();
  if (JSON.stringify([...references].sort()) !== JSON.stringify(registered)) fail(policy.assetContract, "Public asset contract must cover exactly the current literal frontend references");
  for (const id of registered) {
    const name = id.slice(prefix.length), item = contract.assets[id];
    if (!id.startsWith(prefix) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      fail(policy.assetContract, `Invalid public asset contract entry: ${id}`); continue;
    }
    const file = `server/backend/public/assets/${name}`;
    try { if (hash(readFile(file)) !== item.sha256) fail(file, "Backend serving asset differs from the frontend build contract"); }
    catch (error) { if (error.code !== "ENOENT") throw error; fail(file, "Backend serving asset is missing"); }
  }
  return { schemaVersion: 1, publishScopeOptimizationEnabled: false, assets: registered.length, activeBuildRoots: policy.activeBuildRoots, violations };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectFrontendBuildInputs(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(report, null, 2)); if (report.violations.length) process.exitCode = 1;
}
