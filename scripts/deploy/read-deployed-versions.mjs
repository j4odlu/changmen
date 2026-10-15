/** [changmen 扩展] Plan against published versions without requiring live backend/RDS health. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sshRead } from "../verification/release-provenance.mjs";

export const publishedVersionsProgram = `
const fs = await import('node:fs');
const repo = '/root/changmen';
const frontend = fs.realpathSync(repo+'/client/web/dist');
const backend = fs.realpathSync(repo+'/backend-current');
const markers = Object.fromEntries(['frontend','backend'].map(role => [role,fs.readFileSync(repo+'/.deploy-state/'+role,'utf8').trim()]));
const frontendRuntime = JSON.parse(fs.readFileSync(frontend+'/runtime-version.json','utf8'));
console.log(JSON.stringify({frontend,backend,markers,frontendRuntime}));
`;

export function assertPublishedVersions(snapshot) {
  const result = {};
  for (const role of ["frontend", "backend"]) {
    const commit = snapshot[role]?.match(new RegExp(`/\\.releases/${role}/${role}-([a-f0-9]{40})-\\d+-\\d+$`))?.[1];
    assert(commit, `Invalid published ${role} directory`);
    assert.match(snapshot.markers?.[role] ?? "", /^\d+ [a-f0-9]{40}$/, `Invalid ${role} publication marker`);
    assert.equal(snapshot.markers[role].split(" ")[1], commit, `${role} publication marker/path mismatch`);
    result[role] = commit;
  }
  assert.equal(snapshot.frontendRuntime?.frontend?.commit, result.frontend, "Frontend build/version mismatch");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = assertPublishedVersions(sshRead(publishedVersionsProgram));
  fs.mkdirSync("output/change-validation", { recursive: true });
  fs.writeFileSync("output/change-validation/deployed-versions.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
