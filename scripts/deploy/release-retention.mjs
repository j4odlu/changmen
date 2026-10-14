/** [changmen 扩展] Managed releases retain the current and previous successful version. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function locations(repo, scope) {
  assert(["frontend", "backend"].includes(scope), "Invalid release scope");
  repo = path.resolve(repo);
  const base = path.join(repo, ".releases", scope);
  assert.equal(fs.realpathSync(repo), repo, "Repository must be a real directory");
  assert.equal(fs.realpathSync(base), base, "Release root must be a real directory");
  const state = path.join(repo, ".deploy-state", `${scope}-retained.json`);
  assert.equal(fs.realpathSync(path.dirname(state)), path.dirname(state), "State root must be a real directory");
  const pointer = scope === "backend" ? path.join(repo, "backend-current") : path.join(repo, "client/web/dist");
  return { repo, base, state, pointer };
}
function releasePath(location, value, bootstrap = false) {
  const target = path.resolve(value);
  if (bootstrap && target === location.repo) return target;
  assert.equal(path.dirname(target), location.base, "Release outside managed root");
  assert(!fs.lstatSync(target).isSymbolicLink(), "Release cannot be a symlink");
  assert.equal(fs.realpathSync(target), target, "Release path changed");
  return target;
}
function activePaths() {
  const paths = [];
  if (fs.existsSync("/proc")) for (const pid of fs.readdirSync("/proc").filter(value => /^\d+$/.test(value))) {
    try { paths.push(fs.readlinkSync(`/proc/${pid}/cwd`)); } catch { /* A process may exit during inspection. */ }
  }
  if (process.platform === "linux") {
    const apps = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 10000, maxBuffer: 20 * 1024 * 1024 }));
    for (const app of apps) paths.push(app.pm2_env?.pm_cwd, app.pm2_env?.pm_exec_path);
  }
  return paths.filter(value => typeof value === "string");
}
export function pruneReleases(repo, scope, { running = activePaths } = {}) {
  const location = locations(repo, scope);
  if (!fs.existsSync(location.state)) return { removed: [], skipped: [], initialized: false };
  assert(!fs.lstatSync(location.state).isSymbolicLink(), "Retention state cannot be a symlink");
  const saved = JSON.parse(fs.readFileSync(location.state, "utf8"));
  assert.equal(saved.format, 1);
  const current = releasePath(location, saved.current);
  const previous = saved.previous ? releasePath(location, saved.previous, scope === "backend") : null;
  assert.equal(fs.realpathSync(location.pointer), current, "Current release changed; cleanup refused");
  const active = running(), removed = [], skipped = [];
  const managedName = new RegExp(`^(?:${scope}|${scope === "backend" ? "be" : "fe"}|legacy)-[a-zA-Z0-9-]+$`);
  const candidates = fs.readdirSync(location.base, { withFileTypes: true }).filter(entry =>
    entry.isDirectory() && managedName.test(entry.name));
  for (const entry of candidates) {
    const target = releasePath(location, path.join(location.base, entry.name));
    if (target === current || target === previous) continue;
    if (active.some(value => value === target || value.startsWith(target + path.sep))) { skipped.push(target); continue; }
    assert.equal(fs.realpathSync(location.pointer), current, "Current release changed during cleanup");
    fs.rmSync(target, { recursive: true });
    removed.push(target);
  }
  return { current, previous, removed, skipped, initialized: true };
}
export function recordRelease(repo, scope, current, previous, options) {
  const location = locations(repo, scope);
  current = releasePath(location, current);
  previous = previous ? releasePath(location, previous, scope === "backend") : null;
  assert.equal(fs.realpathSync(location.pointer), current, "Only the active successful release can be recorded");
  if (fs.existsSync(location.state)) {
    assert(!fs.lstatSync(location.state).isSymbolicLink());
    const saved = JSON.parse(fs.readFileSync(location.state, "utf8"));
    // Repeating a successful release must not replace the last rollback version with itself.
    if (saved.current === current) previous = saved.previous;
  }
  const temp = location.state + `.next-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify({ format: 1, current, previous }, null, 2), { flag: "wx" });
  fs.renameSync(temp, location.state);
  return pruneReleases(repo, scope, options);
}

function assetFiles(folder, prefix = "assets") {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), "Frontend assets cannot contain symlinks");
    const relative = `${prefix}/${entry.name}`;
    return entry.isDirectory() ? assetFiles(path.join(folder, entry.name), relative) : [relative];
  });
}
function previousAssets(previous) {
  const inventory = path.join(previous, ".release-assets.json");
  if (fs.existsSync(inventory)) return JSON.parse(fs.readFileSync(inventory, "utf8"));
  // Bootstrap old deployments: follow the actual page's nested references, not retained history.
  const byName = new Map();
  for (const file of assetFiles(path.join(previous, "assets"))) {
    const name = path.posix.basename(file);
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  const found = new Set(), queue = ["index.html"];
  while (queue.length) {
    const file = queue.shift();
    if (!/\.(?:html|js|css|svg)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(previous, file), "utf8");
    const names = text.match(/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|png|svg|webp|woff2?|ttf|jpg|jpeg|gif|ico)/g) ?? [];
    for (const name of names) for (const asset of byName.get(name) ?? []) {
      if (!found.has(asset)) { found.add(asset); queue.push(asset); }
    }
  }
  return [...found];
}
export function prepareFrontendAssets(current, previous) {
  const own = assetFiles(path.join(current, "assets"));
  fs.writeFileSync(path.join(current, ".release-assets.json"), JSON.stringify(own));
  if (!previous) return;
  const files = previousAssets(previous);
  assert(Array.isArray(files) && files.every(file => typeof file === "string" && file.startsWith("assets/")
    && !file.includes("\\") && !file.split("/").some(part => ["", ".", ".."].includes(part))), "Invalid previous asset inventory");
  for (const file of files) {
    const source = path.join(previous, file), target = path.join(current, file);
    assert(fs.realpathSync(source).startsWith(fs.realpathSync(previous) + path.sep), "Asset outside previous release");
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, repo, scope, current, previous] = process.argv.slice(2);
    if (command === "assets") prepareFrontendAssets(repo, scope || null);
    else if (command === "record") console.log(JSON.stringify(recordRelease(repo, scope, current, previous || null)));
    else if (command === "prune") console.log(JSON.stringify(pruneReleases(repo, scope)));
    else throw Error("Expected assets, record or prune");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
