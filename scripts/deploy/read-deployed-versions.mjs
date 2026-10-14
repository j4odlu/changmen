/** [changmen 扩展] Read active releases, not previous push/workflow success markers. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { sshRead, layoutProgram, assertLayout } from "../verification/release-provenance.mjs";
const layout = sshRead(layoutProgram + `
const frontendRuntime=JSON.parse(fs.readFileSync(frontend+'/runtime-version.json','utf8'));
const response=await fetch('http://127.0.0.1:3456/api/runtime-version',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Backend runtime unavailable');
const backendRuntime=await response.json();
console.log(JSON.stringify({...layout,frontendRuntime,backendRuntime}));
`);
const versions = assertLayout(layout);
assert.equal(layout.frontendRuntime.frontend.commit, versions.frontendVersion, "Frontend build/version mismatch");
assert.equal(layout.backendRuntime.backend.commit, versions.backendVersion, "Backend process/version mismatch");
assert.equal(layout.backendRuntime.restartRequired, false, "Backend disk/process differ");
const result = { frontend: versions.frontendVersion, backend: versions.backendVersion };
fs.mkdirSync("output/change-validation", { recursive: true });
fs.writeFileSync("output/change-validation/deployed-versions.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
