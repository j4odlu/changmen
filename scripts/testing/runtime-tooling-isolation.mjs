// [changmen 扩展] Fresh offline installations; no services, credentials, lifecycle scripts or production changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(repo, "output/node-tooling-isolation-20261018/installations");
fs.mkdirSync(out, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-node-tooling-install-"));
const npm = [process.env.npm_execpath, process.env.CHANGMEN_TEST_NPM_CLI,
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].find(file => file && fs.existsSync(file));
assert(npm, "An npm CLI JavaScript file is required");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC)$/i.test(key)));
Object.assign(env, { NODE_OPTIONS: "", NODE_PATH: "", DATABASE_URL: "", DATABASE_URL_PUBLIC: "", DATABASE_URL_INTERNAL: "" });
const manifests = new Set([...readInstallWorkspaces(repo).values()].map(row => `${row.dir}/package.json`));
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repo, encoding: "utf8", maxBuffer: 40 * 1024 * 1024, windowsHide: true }).split("\0").filter(Boolean))]
  .filter(file => ["package.json", "package-lock.json"].includes(file) || manifests.has(file)
    || ["packages/shared/", "server/storage/", "devtools/runtime-tooling/"].some(prefix => file.startsWith(prefix)))
  .filter(file => !/(?:^|\/)\.(?:env(?:\.|$)|npmrc$)|\.(?:pem|key|pfx|p12)$/i.test(file));
const sha = file => createHash("sha256").update(fs.readFileSync(path.join(repo, file))).digest("hex");
const hashes = Object.fromEntries(files.map(file => [file, sha(file)]));
const report = { passed: false, offline: true, lifecycleScriptsEnabled: false, servicesStarted: false,
  productionWrites: false, inputHashes: hashes, results: [] };
const save = () => fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(report, null, 2) + "\n"); save();
try {
  for (const [name, workspace, dev, expected] of [["frontend-runtime", "@changmen/web", false, false],
    ["frontend-build", "@changmen/web", true, true], ["storage-runtime", "@changmen/storage", false, true],
    ["legacy-runtime", "@changmen/runtime-tooling-compat", false, true]]) {
    const root = path.join(temporary, name); fs.mkdirSync(root);
    for (const file of files) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target); }
    const args = [npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
      `--workspace=${workspace}`, "--include-workspace-root=false", dev ? "--include=dev" : "--omit=dev"];
    let output;
    try { output = execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 12 * 1024 * 1024 }); }
    catch (error) { fs.writeFileSync(path.join(out, `${name}.log`), `${error.stdout ?? ""}${error.stderr ?? ""}`); throw error; }
    fs.writeFileSync(path.join(out, `${name}.log`), output);
    const links = fs.readdirSync(path.join(root, "node_modules/@changmen")).sort();
    const graph = JSON.parse(execFileSync(process.execPath, [npm, "ls", `--workspace=${workspace}`, dev ? "--include=dev" : "--omit=dev", "--json", "--all"],
      { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 30 * 1024 * 1024 }));
    const graphWorkspaces = new Set();
    const visit = node => { for (const [dependency, child] of Object.entries(node.dependencies || {})) { if (dependency.startsWith("@changmen/")) graphWorkspaces.add(dependency); visit(child); } }; visit(graph);
    assert.equal(graphWorkspaces.has("@changmen/runtime-tooling"), expected, `${name}: unexpected Node tool runtime dependency`);
    if (expected) assert(links.includes("runtime-tooling"), `${name}: missing native Node package link`);
    if (workspace === "@changmen/web") for (const forbidden of ["backend", "db", "storage", "venue-node-loader", "venue-node-registry", "venue-adapter-tools"])
      assert(!links.includes(forbidden), `${name}: Node/data workspace leaked: ${forbidden}`);
    if (expected) {
      const code = `import assert from 'node:assert/strict';import net from 'node:net';let attempts=0;const deny=()=>{attempts++;throw Error('Network forbidden');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;
const canonical=await import('@changmen/runtime-tooling/runtime_version.js'),old=await import('${workspace === "@changmen/runtime-tooling-compat" ? "@changmen/runtime-tooling-compat/runtime_version.js" : "@changmen/shared/tooling/runtime_version.js"}');
assert.deepEqual(Object.keys(old),Object.keys(canonical));for(const key of Object.keys(old))assert.equal(old[key],canonical[key]);
const port=await import('@changmen/runtime-tooling/dev_web_port.js'),legacy=await import('${workspace === "@changmen/runtime-tooling-compat" ? "@changmen/runtime-tooling-compat/dev_web_port.js" : "@changmen/shared/tooling/dev_web_port.js"}');assert.equal(port.resolveDevWebPort,legacy.resolveDevWebPort);
assert.equal(port.resolveDevWebPort({},'win32'),5274);assert.equal(port.resolveDevWebPort({},'linux'),5174);assert.throws(()=>port.resolveDevWebPort({VITE_DEV_PORT:'65536'}));
${workspace === "@changmen/storage" ? `const storage=await import('@changmen/storage/runtime_version.js');assert.equal(storage.readSourceVersion,canonical.readSourceVersion);const config=await import('@changmen/storage/dev_web_config.js');assert.equal(config.resolveDevWebPort,port.resolveDevWebPort);` : ""}
assert.equal(attempts,0);console.log('native canonical and legacy exports match; network attempts=0');`;
      fs.writeFileSync(path.join(out, `${name}-exports.log`), execFileSync(process.execPath, ["--input-type=module", "--eval", code],
        { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 15000 }));
    }
    for (const file of ["package.json", "package-lock.json"]) assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(repo, file))), `${name}: ${file} changed`);
    report.results.push({ name, workspace, devDependenciesIncluded: dev, nodeToolInDependencyGraph: expected,
      nodeToolLinkPresent: links.includes("runtime-tooling"), dependencyWorkspaces: [...graphWorkspaces].sort(), installedWorkspaces: links, passed: true }); save();
    console.log(`${name}: PASS (${links.length} workspaces)`);
  }
  for (const [file, hash] of Object.entries(hashes)) assert.equal(sha(file), hash, `Installation input changed: ${file}`);
  report.passed = true; report.installationInputsStable = true;
  report.limitations = ["npm may create a workspace link for a build-only file dependency even under omit=dev; the physical tree is not certified as a minimal runtime installation."];
  save();
} finally {
  const target = path.resolve(temporary);
  assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir()));
  assert(path.basename(target).startsWith("changmen-node-tooling-install-"));
  fs.rmSync(target, { recursive: true, force: true });
}
