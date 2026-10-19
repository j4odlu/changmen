// [changmen 扩展] Fresh offline install parity plus default-root dynamic dependency evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { certifyBackendDynamicPaths, assertDynamicPathParity } from "../verification/backend-dynamic-paths.mjs";
import { validationIdentity } from "../verification/verify-change.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "output/backend-dynamic-paths"); fs.mkdirSync(out, { recursive: true });
const identity = validationIdentity(root);
const report = { passed: false, sourceStable: false, identity, productionEnabled: false, productionWrites: false, servicesStarted: false };
const save = () => fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify(report, null, 2)); save();
try {
  execFileSync(process.execPath, ["scripts/testing/backend-install-isolation.mjs"], { cwd: root, stdio: "inherit", windowsHide: true, timeout: 900000 });
  const installation = JSON.parse(fs.readFileSync(path.join(root, "output/backend-install-isolation/verdict.json"), "utf8"));
  assert(installation.passed && installation.sourceStable, "Fresh installation failed");
  assert.deepEqual(installation.identity, identity, "Install evidence belongs to different source inputs");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROCESSOR_ARCHITECTURE)$/i.test(key)));
  Object.assign(env, { NODE_OPTIONS: "", NODE_PATH: "", DATABASE_URL: "", DATABASE_URL_PUBLIC: "", DATABASE_URL_INTERNAL: "" });
  const certificates = [];
  for (const name of ["full", "selected"]) {
    const certificate = certifyBackendDynamicPaths(path.join(installation.temporary, name), installation.profile.entries, env);
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(certificate, null, 2)); certificates.push(certificate);
    console.log(`${name} dynamic paths: ${certificate.records.length} original + ${certificate.expandedRecords.length - certificate.records.length} expanded certified`);
  }
  assertDynamicPathParity(...certificates);
  const selected = certificates[1];
  const probe = `import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
let networkAttempts=0;const blocked=()=>{networkAttempts++;throw Error('Network forbidden in dynamic path probe');};globalThis.fetch=blocked;net.Socket.prototype.connect=blocked;
const root=process.cwd(),targets=${JSON.stringify(selected.targets)},pg=${JSON.stringify(selected.pg)},require=createRequire(path.join(root,'package.json'));
let checked=0;for(const row of targets){const ns=await import(pathToFileURL(path.join(root,row.call.origin.file)).href);const fn=ns[row.call.origin.symbol]||ns.default?.[row.call.origin.symbol];assert.equal(typeof fn,'function');
const loaded=fn(...row.call.arguments),absolute=path.join(root,row.target);let moduleType;for(let dir=path.dirname(absolute);;dir=path.dirname(dir)){const file=path.join(dir,'package.json');if(fs.existsSync(file)){moduleType=JSON.parse(fs.readFileSync(file)).type;break;}assert(dir!==path.dirname(dir));}
const expected=moduleType==='module'?await import(pathToFileURL(absolute).href):require(absolute);assert.equal(loaded,expected);checked++;}
for(const row of pg){const actual=createRequire(path.join(root,row.importer)).resolve('pg',{paths:row.searchPaths.map(dir=>path.join(root,dir))});assert.equal(actual,path.join(root,row.target));assert.equal(typeof require(actual).Pool,'function');assert.equal(typeof require(actual).Client,'function');}
assert.equal(networkAttempts,0);console.log(JSON.stringify({passed:true,sourceBoundTargetsChecked:checked,pgResolversChecked:pg.length,networkAttempts}));`;
  const probeOutput = execFileSync(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: path.join(installation.temporary, "selected"), env, encoding: "utf8", windowsHide: true, timeout: 30000 });
  fs.writeFileSync(path.join(out, "native-dynamic-targets.log"), probeOutput);
  report.dynamicNativeProbe = JSON.parse(probeOutput);
  Object.assign(report, { installationDirectory: installation.temporary, installedWorkspaces: installation.installedWorkspaces,
    processes: selected.entries.length, rawDynamicSites: selected.records.length, expandedDynamicSites: selected.expandedRecords.length,
    uncertified: selected.uncertified.length, projectFiles: selected.graph.files.length, literalSites: selected.graph.resolutions.length,
    sourceBoundCalls: selected.bindings.calls.length, preloadFiles: selected.preloadFiles.length, parityPassed: true,
    defaultProjectClosureCertified: true, externalDependencyInternalsCertified: false, productionEnvironmentCertified: false,
    nativeProbe: installation.nativeProbe });
  report.sourceStable = JSON.stringify(validationIdentity(root)) === JSON.stringify(identity);
  assert(report.sourceStable, "Source changed during dynamic certification"); report.passed = true;
} catch (error) { report.error = error.message; console.error(error); process.exitCode = 1; }
finally { save(); }
