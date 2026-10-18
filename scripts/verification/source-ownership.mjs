// [changmen 扩展] File ownership and source dependency directions, never release selection.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const within = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`);
const test = file => /(?:^|\/)(?:tests?|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/.test(file);
// Only these fixed CLI shapes are allowed at migrated command paths.
export function compatibilityCliSource({ spec, command }) {
  if (typeof spec !== "string" || !spec || /[\r\n]/.test(spec)) throw Error("Invalid compatibility CLI spec");
  if (!command) return `#!/usr/bin/env node\nimport ${JSON.stringify(spec)};\n`;
  if (!["checkConfiguredRdsSchema", "runConfiguredRdsSchema"].includes(command)) throw Error("Invalid compatibility CLI command");
  return `#!/usr/bin/env node\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { ${command} } from ${JSON.stringify(spec)};\nexport * from ${JSON.stringify(spec)};\n\nif (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {\n  ${command}().catch(error => { console.error("[rds] 失败:", error.message); process.exitCode = 1; });\n}\n`;
}
export function validateSourceOwnership(policy) {
  if (policy.schemaVersion !== 1 || policy.purpose !== "source-ownership-only" || policy.publishScopeOptimizationEnabled !== false
    || !Array.isArray(policy.roots) || !Array.isArray(policy.rules) || !policy.rules.length) throw Error("Invalid source ownership policy");
  for (const file of [...policy.roots, ...(policy.toolingRoots || [])]) if (typeof file !== "string" || !file || file.includes("\\") || path.posix.isAbsolute(file) || file.split("/").includes("..") || /^[a-z]:/i.test(file)) throw Error("Invalid source ownership root");
  for (const rule of policy.rules) {
    if (!["frontend", "backend", "rds", "shared"].includes(rule.layer) || Boolean(rule.prefix) === Boolean(rule.files)) throw Error("Invalid source ownership rule");
    for (const file of rule.files || [rule.prefix]) if (!file || file.includes("\\") || path.posix.isAbsolute(file) || file.split("/").includes("..") || /^[a-z]:/i.test(file)) throw Error("Invalid source ownership path");
  }
  return policy;
}
export function classifySourceFile(file, policy) {
  const rule = policy.rules.find(row => row.files?.includes(file) || row.prefix && within(file, row.prefix));
  if (!rule) return null;
  return { layer: rule.layer, role: test(file) ? "test" : rule.role || (/\.(?:sql|json)$/.test(file) ? "asset" : file.includes("/scripts/") ? "tooling" : "runtime") };
}
export function sourceLayerViolation(file, target, policy) {
  const source = classifySourceFile(file, policy), destination = classifySourceFile(target, policy);
  if (!source || !destination) {
    const missing = !source ? file : target;
    return policy.roots.some(root => within(missing, root)) ? `Unclassified source dependency: ${missing}` : null;
  }
  const blocked = source.layer === "frontend" && ["backend", "rds"].includes(destination.layer)
    || ["backend", "rds"].includes(source.layer) && destination.layer === "frontend"
    || source.layer === "shared" && destination.layer !== "shared"
    || source.layer === "rds" && destination.layer === "backend" && destination.role !== "infrastructure";
  return blocked ? `${source.layer} source cannot depend on ${destination.layer} ${target}` : null;
}
export function sourceOwnershipInventory(root) {
  const policy = validateSourceOwnership(JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/source-ownership-inputs.json"), "utf8")));
  const protectedPaths = JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/vps-fok-baseline.json"), "utf8")).protectedFiles;
  const files = [], unclassified = [], incompatibleAssets = [], incompatibleEntries = [];
  for (const entry of policy.compatibilityCliEntries || []) {
    for (const name of [entry.file, entry.canonical]) if (!name || path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Invalid compatibility CLI path");
    if (!fs.existsSync(path.join(root, entry.canonical))
      || fs.readFileSync(path.join(root, entry.file), "utf8").replaceAll("\r\n", "\n") !== compatibilityCliSource(entry)) incompatibleEntries.push({ file: entry.file, canonical: entry.canonical });
  }
  for (const { file, canonical, spec } of policy.compatibilityEntries || []) {
    for (const name of [file, canonical]) if (!name || path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Invalid compatibility entry path");
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "").trim();
    if (!fs.existsSync(path.join(root, canonical)) || text !== `export * from ${JSON.stringify(spec)};`) incompatibleEntries.push({ file, canonical });
  }
  for (const { file, canonical } of policy.compatibilityAssets || []) {
    for (const name of [file, canonical]) if (!name || path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Invalid compatibility asset path");
    if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(root, canonical)))) incompatibleAssets.push({ file, canonical });
  }
  const skip = new Set(["node_modules", "dist", "coverage", "platform_adapter", "platform_node"]);
  function recordFile(file) {
    const owner = classifySourceFile(file, policy);
    if (!owner) unclassified.push(file);
    else files.push({ file, ...owner, protected551: Object.hasOwn(protectedPaths, file) });
  }
  function walk(directory) {
    if (directory === "server/backend/storage") return;
    if (fs.statSync(path.join(root, directory)).isFile()) { recordFile(directory); return; }
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (item.name.startsWith(".") || item.isSymbolicLink() || skip.has(item.name)) continue;
      const file = `${directory}/${item.name}`;
      if (item.isDirectory()) walk(file);
      else if (/\.(?:[cm]?[jt]sx?|vue|sql)$/.test(file) || policy.rules.some(rule => rule.files?.includes(file))
        || policy.compatibilityAssets?.some(row => row.file === file || row.canonical === file)) {
        recordFile(file);
      }
    }
  }
  for (const directory of policy.roots) walk(directory);
  const counts = Object.fromEntries(["frontend", "backend", "rds", "shared"].map(layer => [layer, files.filter(row => row.layer === layer).length]));
  return { schemaVersion: 1, purpose: policy.purpose, publishScopeOptimizationEnabled: false, files, counts, unclassified, incompatibleAssets, incompatibleEntries };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = sourceOwnershipInventory(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(process.argv.includes("--json") ? report : { counts: report.counts, unclassified: report.unclassified, incompatibleAssets: report.incompatibleAssets, incompatibleEntries: report.incompatibleEntries }, null, 2));
  if (report.unclassified.length || report.incompatibleAssets.length || report.incompatibleEntries.length) process.exitCode = 1;
}
