// [changmen 扩展] Only undo the exact refactor checks added to the historical checker.
// This offline inverse preserves the original 9999 and workspace proof hashes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const fileName = "scripts/verification/workspace-layout-relocation.mjs";
const beforeSha = "88a961f9e97c3709223cc704addcb322c5445fc1ed38e9ccaa067495c1d1f6a6";
const afterSha = "775ff9bb3aa26f26f4043b985be491d7df384f433970657f451b46eaf3c80618";
const edits = [
  ["import {inspectBackendCommandPaths,restoreBackendCommandPaths} from './backend-command-paths.mjs';\nimport {restoreFrontendDependencySource,verifyFrontendDependencyRefactor} from './frontend-dependency-refactor.mjs';\nimport {verifyAccountEditExtraction} from './account-edit-extraction.mjs';\nimport {verifyPendingVenueFixes} from './pending-venue-fixes.mjs';\n", ""],
  [" const backendCommands=inspectBackendCommandPaths(root,{read});\n const frontendDependencies=verifyFrontendDependencyRefactor(read);\n verifyAccountEditExtraction(read);\n verifyPendingVenueFixes(read);\n", ""],
  ["restoreBackendCommandPaths(row.canonical,restoreRayA8PrecheckSource(row.canonical,restoreDeployCiSource(row.canonical,restore9999CProbabilityVerificationSource(row.canonical,restoreFrontendDependencySource(row.canonical,read(row.canonical))))))", "restoreRayA8PrecheckSource(row.canonical,restoreDeployCiSource(row.canonical,restore9999CProbabilityVerificationSource(row.canonical,read(row.canonical))))"],
  ["platformRoot:'server/venues',backendCommands:backendCommands.commands,frontendDependencies", "platformRoot:'server/venues'"],
];
export function restoreRefactorVerificationWiring(file, source) {
  if (file !== fileName || sha(source) !== afterSha) return source;
  source = source.replaceAll("\r\n", "\n");
  for (const [after, before] of edits) {
    assert.equal(source.split(after).length, 2, `${file}: exact refactor check wiring must occur once`);
    source = source.replace(after, before);
  }
  assert.equal(sha(source), beforeSha, `${file}: complete original checker must restore`);
  return source;
}
