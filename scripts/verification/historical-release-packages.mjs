// [changmen 扩展] 历史发布包只验收原提交；当前版本继续由完整 FOK/VPS 和兼容组合保护。
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createReadonlyGitScope, normalizedSha } from "./orders-phase2-git-scope.mjs";
import { verifyPhase2Module } from "./orders-phase2-release-boundary.mjs";
import { restoreMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";

export const historicalPackages = Object.freeze([
  { metadata: "scripts/verification/orders-phase2-release-scope.json", base: "113db6ff4e59dd615f8dd867e11d859b05766b7d", version: "313c19e8afc30d62b54363830974b6738eab84d8" },
  { metadata: "scripts/verification/pm-orders-minimal-scope.json", base: "313c19e8afc30d62b54363830974b6738eab84d8", version: "3e5ed4f12a912ee0262b7c5a1477184f43edb2f0" },
]);
export function verifyHistoricalPackage(spec, { git = createReadonlyGitScope(), readMetadata = file => fs.readFileSync(file, "utf8"), transformSource = (_, source) => source } = {}) {
  assert(historicalPackages.includes(spec), "Only the original historical package versions are accepted");
  const text = readMetadata(spec.metadata), originalMetadata = git.readBlobs(spec.version, [spec.metadata])[spec.metadata];
  assert.equal(normalizedSha(text), normalizedSha(originalMetadata), "immutable historical scope metadata");
  const scope = JSON.parse(text);
  assert.equal(scope.base, spec.base);
  git.assertAncestor(spec.base, spec.version);
  const files = Object.keys(scope.allowedFiles), expected = [...files, spec.metadata].sort();
  assert.deepEqual(git.committedPaths(spec.base, spec.version).sort(), expected, "complete historical release path range");
  const contents = git.readBlobs(spec.version, files);
  for (const file of files) {
    contents[file] = transformSource(file, contents[file]);
    assert.equal(normalizedSha(contents[file]), scope.allowedFiles[file], `${file}: original release bytes`);
  }
  const read = file => (contents[file] ?? git.readBlobs(spec.version, [file])[file]).replaceAll("\r\n", "\n");
  if (spec === historicalPackages[0]) {
    for (const file of scope.existingRuntime) verifyPhase2Module(file, read(file), read);
  } else {
    for (const file of [...scope.existingRuntime, ...scope.existingFixtures]) {
      assert.equal(restoreMinimalOrdersSource(file, read(file), read), git.readBlobs(spec.base, [file])[file].replaceAll("\r\n", "\n"), `${file}: complete original minimal package boundary`);
    }
  }
  return { version: spec.version, base: spec.base, paths: expected.length, runtimeModules: scope.existingRuntime.length, passed: true };
}
