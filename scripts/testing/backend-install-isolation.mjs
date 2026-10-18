// [changmen 扩展] Disposable offline experiment; never installs into the working checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { backendInstallProfile, assertBackendInstalledLinks, forbiddenBackendPackages } from "../deploy/backend-install-profile.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
import { validationIdentity } from "../verification/verify-change.mjs";
import { captureBackendResolution, assertBackendResolutionParity } from "../verification/backend-install-resolution.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url)), out = path.join(repo, "output/backend-install-isolation");
fs.mkdirSync(out, { recursive: true });
const identity = validationIdentity(repo), profile = backendInstallProfile(repo);
const report = { passed: false, sourceStable: false, identity, productionEnabled: false, productionWrites: false,
  servicesStarted: false, lifecycleScriptsEnabled: false, profile, steps: [] };
const save = () => fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify(report, null, 2)); save();
const npm = [process.env.CHANGMEN_TEST_NPM_CLI, process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].find(file => file && fs.existsSync(file));
assert(npm, "Set CHANGMEN_TEST_NPM_CLI to an npm CLI JavaScript file");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-eight-process-install-"));
assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
report.temporary = temporary;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROCESSOR_ARCHITECTURE)$/i.test(key)));
Object.assign(env, { NODE_OPTIONS: "", NODE_PATH: "", DATABASE_URL: "", DATABASE_URL_PUBLIC: "", DATABASE_URL_INTERNAL: "" });
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repo, encoding: "utf8", maxBuffer: 30 * 1024 * 1024, windowsHide: true }).split("\0").filter(Boolean);
const manifests = new Set([...readInstallWorkspaces(repo).values()].map(item => `${item.dir}/package.json`));
const copied = file => ["package.json", "package-lock.json"].includes(file) || manifests.has(file)
  || [...profile.workspaceDirectories, "packages/venue-adapter"].some(dir => file.startsWith(`${dir}/`));
const copy = root => {
  fs.mkdirSync(root);
  for (const file of files) {
    if (!copied(file) || /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.npmrc$|\.(?:pem|key|pfx|p12)$|^server\/backend\/storage\//i.test(file)) continue;
    const source = path.join(repo, file); if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  }
};
const command = (name, root, args) => {
  const start = Date.now(); let passed = false;
  try { const output = execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 180000, windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, `${name}.log`), output); passed = true; return output; }
  catch (error) { fs.writeFileSync(path.join(out, `${name}.log`), `${error.stdout ?? ""}${error.stderr ?? ""}\n${error.message}`); throw error; }
  finally { report.steps.push({ name, passed, elapsedMs: Date.now() - start }); save(); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); }
};
try {
  const cache = process.env.CHANGMEN_TEST_NPM_CACHE;
  const options = ["--offline", "--ignore-scripts", "--no-audit", "--no-fund", ...(cache ? ["--cache", cache] : [])];
  const baseline = path.join(temporary, "full"), candidate = path.join(temporary, "selected");
  copy(baseline); copy(candidate);
  command("full-install", baseline, [npm, "ci", "--include=dev", ...options]);
  command("selected-install", candidate, [npm, ...profile.installArgs, ...options]);
  for (const root of [baseline, candidate]) for (const file of ["package.json", "package-lock.json"])
    assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(repo, file))), `${file} changed`);
  const links = fs.readdirSync(path.join(candidate, "node_modules/@changmen")); assertBackendInstalledLinks(profile, links);
  report.installedWorkspaces = links.sort();
  for (const root of [baseline, candidate]) command(root === baseline ? "full-router" : "selected-router", root,
    [npm, "run", "compile:router", "--workspace=@changmen/backend"]);
  const full = captureBackendResolution(baseline, profile.entries, env), selected = captureBackendResolution(candidate, profile.entries, env);
  fs.writeFileSync(path.join(out, "full-resolution.json"), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(out, "selected-resolution.json"), JSON.stringify(selected, null, 2));
  assertBackendResolutionParity(full, selected);
  report.resolution = { parityPassed: true, files: full.files.length, literalSites: full.resolutions.length,
    unresolved: full.unresolved.length, unknown: full.unknown.length, completeRuntimeClosureCertified: false };
  const probe = `import assert from'node:assert/strict';import{createRequire}from'node:module';import net from'node:net';import{pathToFileURL}from'node:url';
let attempts=0;const blocked=()=>{attempts++;throw Error('Network forbidden in installation verification');};globalThis.fetch=blocked;net.Socket.prototype.connect=blocked;
const root=process.cwd(),req=createRequire(root+'/server/backend/package.json');
for(const name of ${JSON.stringify(forbiddenBackendPackages)})assert.throws(()=>req.resolve(name));
const loader=await import('@changmen/venue-node-loader');assert.equal(loader,await import(pathToFileURL(root+'/packages/venue-adapter/loader/adapter_paths.mjs').href));
await loader.initAdapterRegistry();await loader.initEsmPlatformBackends();
for(const id of ['OB','PB','RAY'])assert(loader.requirePlatform(id,'node','session.js'));
assert.equal(typeof(await import('@changmen/team-resolver')).resolve,'function');assert.equal(attempts,0);
console.log(JSON.stringify({passed:true,networkAttempts:attempts,originalLoaderIdentity:true,registryAndPreloads:true}));`;
  report.nativeProbe = JSON.parse(command("selected-loader", candidate, ["--input-type=module", "--eval", probe]));
  report.sourceStable = JSON.stringify(validationIdentity(repo)) === JSON.stringify(identity);
  assert(report.sourceStable, "Source changed during install experiment"); report.passed = true; save();
} catch (error) { report.error = error.message; save(); console.error(error.message); process.exitCode = 1; }
// Keep the uniquely named temporary directories for review; no recursive cleanup of a user path.
