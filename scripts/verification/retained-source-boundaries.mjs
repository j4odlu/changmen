// [changmen 扩展] Named retained boundaries add checks, never exemptions or release authority.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sharedLoaderSourceSignature } from "./pm-shared-loader-evidence.mjs";
import { inspectRdsAssetCopies } from "./rds-assets.mjs";
import { restorePmClientFolderMetadata } from "./pm-source-isolation-metadata.mjs";

const ids = ["frozen-adapter-island", "compatibility-entries", "rds-assets", "frozen-database-island", "backend-bundle-tool", "layout-roots"];
const digest = text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
export function inspectRetainedSourceBoundaries(root) {
  const read = file => {
    if (typeof file !== "string" || !file || path.isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) throw Error("Invalid retained boundary path");
    const absolute = path.join(root, file), relative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw Error("Retained boundary escapes workspace");
    return fs.readFileSync(absolute, "utf8");
  };
  const json = file => JSON.parse(read(file));
  const policy = json("scripts/verification/retained-source-boundaries.json"), violations = [];
  if (policy.schemaVersion !== 1 || policy.purpose !== "retained-source-boundaries-only" || policy.publishScopeOptimizationEnabled !== false
    || !Array.isArray(policy.groups) || JSON.stringify(policy.groups.map(group => group.id).sort()) !== JSON.stringify([...ids].sort())) throw Error("Invalid retained source boundary policy");
  for (const group of policy.groups) {
    if (!group.owner || !group.reason || !group.exitCondition || !Array.isArray(group.files) || !group.files.length) throw Error(`Incomplete retained boundary: ${group.id}`);
    for (const file of group.files) read(file);
  }
  const group = id => policy.groups.find(item => item.id === id);
  const fail = (file, pattern) => violations.push({ rule: "retained-source-boundary", file, line: 0, spec: "retained contract", pattern });
  const manifest = json("scripts/verification/vps-fok-baseline.json");
  if (Object.keys(manifest.protectedFiles).length !== 551) fail("scripts/verification/vps-fok-baseline.json", "Original complete 551 protection must remain present");
  const frozenPaths = Object.keys(manifest.protectedFiles).filter(file => file.startsWith("packages/venue-adapter/loader/") || file.startsWith("packages/venue-adapter/registry/")).sort();
  if (JSON.stringify([...group("frozen-adapter-island").files].sort()) !== JSON.stringify(frozenPaths)) fail("scripts/verification/retained-source-boundaries.json", "Every original frozen adapter island path must remain inventoried");
  for (const file of group("frozen-adapter-island").files) {
    if (!manifest.protectedFiles[file] || digest(read(file)) !== manifest.protectedFiles[file]) fail(file, "Original frozen source/path must remain protected and unchanged");
  }
  const ownership = json("scripts/verification/source-ownership-inputs.json");
  const contracts = { entries: ownership.compatibilityEntries, commands: ownership.compatibilityCliEntries, assets: ownership.compatibilityAssets };
  // [changmen 扩展] 仅还原三条已审前端工具入口迁移，继续核对原兼容契约 hash。
  const previousOwnership = JSON.parse(restorePmClientFolderMetadata("scripts/verification/source-ownership-inputs.json",
    read("scripts/verification/source-ownership-inputs.json")));
  const previousContracts = { entries: previousOwnership.compatibilityEntries, commands: previousOwnership.compatibilityCliEntries, assets: previousOwnership.compatibilityAssets };
  if (digest(JSON.stringify(previousContracts)) !== group("compatibility-entries").contractSha256)
    fail("scripts/verification/source-ownership-inputs.json", "Retained compatibility entries cannot be deregistered or redirected without a separate contract review");
  const schema = json("server/db/assets/schema-baseline.json");
  for (const file of ["server/db/assets/schema-baseline.json", "server/backend/scripts/rds-schema-baseline.json"])
    if (digest(read(file)) !== group("rds-assets").baselineSha256) fail(file, "Retained schema baseline must remain unchanged");
  const expectedAssets = ["server/db/assets/schema-baseline.json", "server/backend/scripts/rds-schema-baseline.json", ...Object.keys(schema.migrations)
    .flatMap(name => [`server/db/assets/migrations/${name}`, `server/backend/db/migrations/${name}`])].sort();
  if (JSON.stringify([...group("rds-assets").files].sort()) !== JSON.stringify(expectedAssets)) fail("server/backend/db/migrations", "Every canonical schema SQL asset must remain explicitly inventoried");
  for (const [name, checksum] of Object.entries(schema.migrations)) {
    for (const file of [`server/db/assets/migrations/${name}`, `server/backend/db/migrations/${name}`])
      if (digest(read(file)) !== checksum) fail(file, "Original SQL checksum must remain unchanged");
  }
  try { violations.push(...inspectRdsAssetCopies(root).violations); }
  catch (error) { fail("server/db/assets", error.message); }
  const exceptions = json("scripts/verification/backend-db-access-exceptions.json");
  if (digest(JSON.stringify(exceptions)) !== group("frozen-database-island").contractSha256
    || exceptions.sites.length !== 8 || exceptions.sites.some(site => site.file !== "server/backend/core/account/admin_maintenance.js"))
    fail("scripts/verification/backend-db-access-exceptions.json", "Only the existing eight frozen database access locations may remain");
  const bundler = group("backend-bundle-tool");
  if (digest(read(bundler.files[0])) !== bundler.sourceSha256) fail(bundler.files[0], "Retained bundle copying and source root contract must remain unchanged");
  const inputs = json("scripts/verification/pm-shared-loader-inputs.json");
  for (const file of group("layout-roots").files) {
    const source = inputs.sourceContracts.find(contract => contract.file === file && contract.selector === "module");
    if (!source || sharedLoaderSourceSignature(file, read(file), source.selector) !== source.signature) fail(file, "Existing layout-root source contract must remain intact");
  }
  return { schemaVersion: 1, purpose: policy.purpose, publishScopeOptimizationEnabled: false, installationCertified: false,
    groups: policy.groups, compatibilityEntries: contracts.entries.length, compatibilityCliEntries: contracts.commands.length,
    compatibilityAssets: contracts.assets.length, violations };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectRetainedSourceBoundaries(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(report, null, 2));
  if (report.violations.length) process.exitCode = 1;
}
