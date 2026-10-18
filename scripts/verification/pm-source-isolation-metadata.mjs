// [changmen 扩展] 精确还原三份源码隔离元数据；原历史基线和完整源码相等断言不变。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

export const PM_METADATA_BASELINE = "a233e20534395b31401828e754432407b109053d";
const record = JSON.parse(fs.readFileSync(new URL("./pm-source-isolation-metadata.json", import.meta.url), "utf8"));
assert.equal(record.schemaVersion, 1);
assert.equal(record.baseline, PM_METADATA_BASELINE, "metadata migration cannot replace the historical baseline");
assert.deepEqual(record.changes.map(row => row.file), ["server/db/package.json", "packages/shared/package.json", "package-lock.json"]);
const changes = new Map(record.changes.map(row => [row.file, row]));
const frontendInstall = JSON.parse(fs.readFileSync(new URL("./pm-frontend-install-metadata.json", import.meta.url), "utf8"));
assert.equal(frontendInstall.schemaVersion, 1);
assert.equal(frontendInstall.file, "package-lock.json");
assert.equal(frontendInstall.baselineSha256, changes.get("package-lock.json").migratedSha256,
  "frontend install migration must restore the already registered lock, never replace its original proof");
const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(source).digest("hex");
const frontendBuild = JSON.parse(fs.readFileSync(new URL("./pm-frontend-build-metadata.json", import.meta.url), "utf8"));
assert.equal(frontendBuild.schemaVersion, 1);
assert.deepEqual(frontendBuild.changes.map(row => row.file), ["packages/shared/package.json", "package-lock.json"]);
for (const row of frontendBuild.changes)
  assert.equal(row.baselineSha256, row.file === "package-lock.json" ? frontendInstall.migratedSha256 : changes.get(row.file).migratedSha256,
    "build source migration must restore the previous exact metadata proof");
const nodeConsumer = JSON.parse(fs.readFileSync(new URL("./pm-node-consumer-metadata.json", import.meta.url), "utf8"));
assert.equal(nodeConsumer.schemaVersion, 1);
assert.equal(nodeConsumer.file, "package-lock.json");
assert.equal(nodeConsumer.baselineSha256, frontendBuild.changes.find(row => row.file === nodeConsumer.file).migratedSha256,
  "Node consumer migration must restore the previous complete lock, never replace its proof");
const backendTool = JSON.parse(fs.readFileSync(new URL("./pm-backend-tool-metadata.json", import.meta.url), "utf8"));
assert.equal(backendTool.schemaVersion, 1);
assert.equal(backendTool.file, "package-lock.json");
assert.equal(backendTool.baselineSha256, nodeConsumer.migratedSha256,
  "Backend tooling migration must restore the previous complete Node-consumer lock proof");
const clientFolder = JSON.parse(fs.readFileSync(new URL("./pm-client-folder-metadata.json", import.meta.url), "utf8"));
assert.equal(clientFolder.schemaVersion, 1);
assert.equal(clientFolder.purpose, "client-folder-isolation-only");
assert.equal(clientFolder.historicalBaseline, PM_METADATA_BASELINE);
assert.deepEqual(clientFolder.changes.map(row => row.file), ["package.json", "package-lock.json", "client/web/package.json",
  "packages/venue-adapter/package.json", "scripts/verification/source-ownership-inputs.json"]);
assert.equal(clientFolder.changes.find(row => row.file === "package-lock.json").baselineSha256, backendTool.migratedSha256,
  "Client folder migration must restore the complete registered backend-tool lock");

function reverseChange(file, source, change) {
  assert.equal(sha(source), change.migratedSha256, `${file}: only the exact registered metadata migration is accepted`);
  const lines = source.split("\n");
  for (const patch of [...change.patches].reverse()) {
    assert.equal(patch.before.length, patch.oldCount, `${file}: exact original patch length`);
    assert.equal(patch.after.length, patch.newCount, `${file}: exact migrated patch length`);
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    assert(Number.isInteger(start) && start >= 0 && start <= lines.length, `${file}: exact migrated position`);
    assert.deepEqual(lines.slice(start, start + patch.newCount), patch.after, `${file}: exact migrated patch text`);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const restored = lines.join("\n");
  assert.equal(sha(restored), change.baselineSha256, `${file}: complete source before this exact migration`);
  return restored;
}

// Test/source view only: all unknown text still reaches the original strict full-file assertions below.
export function restorePmClientFolderMetadata(file, source) {
  source = normalize(source);
  const change = clientFolder.changes.find(row => row.file === file);
  return change && sha(source) === change.migratedSha256 ? reverseChange(file, source, change) : source;
}

export function restorePmBackendToolMetadata(file, source) {
  source = restorePmClientFolderMetadata(file, source);
  return file === backendTool.file && sha(source) === backendTool.migratedSha256 ? reverseChange(file, source, backendTool) : source;
}

export function restorePmNodeConsumerMetadata(file, source) {
  source = restorePmBackendToolMetadata(file, source);
  return file === nodeConsumer.file && sha(source) === nodeConsumer.migratedSha256 ? reverseChange(file, source, nodeConsumer) : source;
}

export function restorePmFrontendBuildMetadata(file, source) {
  source = restorePmNodeConsumerMetadata(file, source);
  const change = frontendBuild.changes.find(row => row.file === file);
  return change && sha(source) === change.migratedSha256 ? reverseChange(file, source, change) : source;
}

export function restorePmSourceIsolationMetadata(file, source, original) {
  source = normalize(source);
  const change = changes.get(file);
  // Unregistered files retain the caller's existing complete-source equality check.
  if (!change) return source;
  original = normalize(original);
  assert.equal(sha(original), change.baselineSha256, `${file}: immutable original metadata source`);
  if (source === original) return source;
  source = restorePmFrontendBuildMetadata(file, source);
  if (file === "package-lock.json" && sha(source) !== change.migratedSha256)
    source = reverseChange(file, source, frontendInstall);
  const restored = reverseChange(file, source, change);
  assert.equal(restored, original, `${file}: complete original source after reversing registered migration`);
  return restored;
}
