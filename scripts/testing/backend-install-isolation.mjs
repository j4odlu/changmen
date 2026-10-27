// [changmen 扩展] Disposable offline experiment; never installs into the working checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { backendInstallProfile, assertBackendInstalledLinks, assertBackendBrowserPackagesAbsent } from "../deploy/backend-install-profile.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
import { validationIdentity } from "../verification/verify-change.mjs";
import { captureBackendResolution, assertBackendResolutionParity } from "../verification/backend-install-resolution.mjs";
import { compileBackendRouter } from "../deploy/compile-backend-router.mjs";
import { verifyBackendInstallation } from "../deploy/install-backend.mjs";

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
  || profile.workspaceDirectories.some(dir => file.startsWith(`${dir}/`));
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
  compileBackendRouter(candidate, repo, new Date(0));
  command("full-install", baseline, [npm, "ci", "--include=dev", ...options]);
  command("selected-install", candidate, [npm, ...profile.installArgs, ...options]);
  for (const root of [baseline, candidate]) for (const file of ["package.json", "package-lock.json"])
    assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(repo, file))), `${file} changed`);
  const links = fs.readdirSync(path.join(candidate, "node_modules/@changmen")); assertBackendInstalledLinks(profile, links);
  assertBackendBrowserPackagesAbsent(candidate, profile);
  report.browserPackagesAbsent = true;
  report.installedWorkspaces = links.sort();
  command("full-router", baseline, [npm, "run", "compile:router", "--workspace=@changmen/backend"]);
  command("selected-router-verify", candidate, ["server/backend/scripts/ensure-router-compiled.mjs", "--verify"]);
  report.installation = verifyBackendInstallation(candidate, profile);
  const full = captureBackendResolution(baseline, profile.entries, env), selected = captureBackendResolution(candidate, profile.entries, env);
  fs.writeFileSync(path.join(out, "full-resolution.json"), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(out, "selected-resolution.json"), JSON.stringify(selected, null, 2));
  assertBackendResolutionParity(full, selected);
  report.resolution = { parityPassed: true, files: full.files.length, literalSites: full.resolutions.length,
    unresolved: full.unresolved.length, unknown: full.unknown.length, completeRuntimeClosureCertified: false };
  const probe = `import assert from'node:assert/strict';import net from'node:net';import{pathToFileURL}from'node:url';
let attempts=0;const blocked=()=>{attempts++;throw Error('Network forbidden in installation verification');};globalThis.fetch=blocked;net.Socket.prototype.connect=blocked;
const root=process.cwd();
const loader=await import('@changmen/venue-node');const legacy=await import(pathToFileURL(root+'/server/venues/loader/adapter_paths.mjs').href);
assert.deepEqual(Object.keys(loader),Object.keys(legacy));for(const key of Object.keys(loader))assert.equal(loader[key],legacy[key]);
await loader.initAdapterRegistry();await loader.initEsmPlatformBackends();
for(const id of ['OB','PB','RAY'])assert(loader.requirePlatform(id,'node','session.js'));
const resolver=await import('@changmen/team-resolver');
const teams=await import('@changmen/team-resolver/team_db'),sport=await import('@changmen/team-resolver/sport_team_plugin');
assert.equal(resolver.loadAndCreatePlugin,teams.loadAndCreatePlugin);
assert.equal(resolver.createSportTeamPlugin,sport.createSportTeamPlugin);
assert.equal(resolver.resolveSportTeamKey('Manchester City','epl'),'manchester city');
for(const key of ['resolve','resolveMatch','scoreMatchPair'])assert(!(key in resolver));
assert.equal(attempts,0);
const fs=await import('node:fs');const bundle=await import('@changmen/venue-node/sync-backend-bundle.mjs');
const packed=bundle.syncPlatformAdapterBackendBundle({dst:root+'/output/isolated-adapter'});
assert(fs.readFileSync(packed+'/registry/manifest.json').equals(fs.readFileSync(root+'/packages/shared/catalog/venue_manifest.json')));
assert.equal(attempts,0);
assert(!fs.existsSync(root+'/packages/venue-adapter/loader/adapter_paths.mjs'));assert(!fs.existsSync(root+'/packages/venue-adapter/registry/manifest.json'));
console.log(JSON.stringify({oldAdapterSourcesAbsent:true,passed:true,networkAttempts:attempts,resolverRootIdentity:true,originalLoaderIdentity:true,registryAndPreloads:true,sharedCatalogBundle:true}));`;
  report.nativeProbe = JSON.parse(command("selected-loader", candidate, ["--input-type=module", "--eval", probe]));
  report.sourceStable = JSON.stringify(validationIdentity(repo)) === JSON.stringify(identity);
  assert(report.sourceStable, "Source changed during install experiment"); report.passed = true; save();
} catch (error) { report.error = error.message; save(); console.error(error.message); process.exitCode = 1; }
// Keep the uniquely named temporary directories for review; no recursive cleanup of a user path.
