/** [changmen 扩展] 只识别源码身份；不加载应用、凭证或数据库，也不决定交易许可。 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const digest = value => createHash("sha256").update(value).digest("hex");
const normalize = value => value.replaceAll("\r\n", "\n");
const shaPattern = /^[a-f0-9]{40}$/;
const excluded = /(?:^|\/)(?:node_modules|dist|docs|output|test|tests|__tests__|\.git|\.ai|\.claude)(?:\/|$)|\.(?:test|spec)\./;
const sourceExtension = /\.(?:[cm]?js|tsx?|vue|json|ya?ml|sql|toml)$/;
const frontendAsset = /\.(?:css|scss|less|html|svg|png|jpe?g|webp|gif|woff2?)$/;
const binaryAsset = /\.(?:png|jpe?g|webp|gif|woff2?)$/;
const generatedRoutes = new Set(["router", "account_client_routes", "action_registry", "admin_routes", "pm_pf_routes"].map(name => `server/backend/core/esport-api/${name}.js`));
export function isVersionSource(file, role) {
  if (!["frontend", "backend"].includes(role)) throw Error("Unknown runtime role");
  if (excluded.test(file) || !(sourceExtension.test(file) || (role === "frontend" && frontendAsset.test(file))) || /(?:^|\/)\.env(?:\.|$)/.test(file)) return false;
  // Compiled routes are represented by tracked TS; heartbeats are runtime data.
  if (generatedRoutes.has(file) || /^server\/match\/matcher\/\.(?:composer|matcher)-heartbeat\.json$/.test(file)) return false;
  if (/^server\/backend\/(?:storage|scripts\/ops)\//.test(file)) return false;
  if (["package.json", "package-lock.json", "server/storage/runtime_version.js"].includes(file)) return true;
  // Browser-owned implementations are absent from backend release artifacts.
  // Shared contracts/rules and all Node loader resources remain fingerprinted.
  if (file.startsWith("packages/match-identity/")) return role === "backend";
  if (file.startsWith("client/packages/")) return role === "frontend";
  if (/^server\/packages\/(?:venue-node-(?:loader|registry)|venue-adapter-tools)\//.test(file) || file.startsWith("server/venues/")) return true;
  if (file.startsWith("devtools/runtime-tooling/")) return true;
  return role === "frontend"
    ? /^(?:client\/web\/(?:src\/|public\/|vite\/|vite\.config\.ts|package\.json|scripts\/run-production-build\.mjs)|packages\/)/.test(file)
    : /^(?:rds\/|server\/|packages\/(?:shared|api-contract|match-identity)\/|devtools\/platform-probes\/)/.test(file);
}
const contractSource = file => /^packages\/api-contract\//.test(file)
  || ["packages/shared/pm_gtc.ts", "packages/shared/pm_gtc_recovery.ts"].includes(file);
function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 3000, maxBuffer: 80 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], ...options });
}
function walk(root) {
  const files = [];
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${item.name}` : item.name;
      if (excluded.test(file)) continue;
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push(file);
    }
  };
  for (const dir of ["client/web/src", "client/web/public", "client/web/vite", "client/web/scripts", "client/packages", "devtools/runtime-tooling", "packages", "server", "rds", "devtools/platform-probes"])
    if (fs.existsSync(path.join(root, dir))) visit(dir);
  for (const file of ["package.json", "package-lock.json", "client/web/package.json", "client/web/vite.config.ts"])
    if (fs.existsSync(path.join(root, file))) files.push(file);
  return files;
}
function fingerprint(files, read) {
  return digest([...new Set(files)].sort().map(file => {
    const value = read(file);
    return `${file}\0${value === null ? "missing" : `present\0${digest(value)}`}`;
  }).join("\n"));
}
function committedSources(root, commit, files) {
  const objects = Buffer.from(git(root, ["cat-file", "--batch"], { encoding: null, input: files.map(file => `${commit}:${file}`).join("\n") + "\n" }));
  const sources = new Map(); let offset = 0;
  for (const file of files) {
    const end = objects.indexOf(10, offset), header = objects.subarray(offset, end).toString().split(" ");
    if (header[1] !== "blob") throw Error("Source blob unavailable");
    const size = Number(header[2]);
    const bytes = objects.subarray(end + 1, end + 1 + size);
    sources.set(file, binaryAsset.test(file) ? bytes : normalize(bytes.toString("utf8"))); offset = end + 1 + size + 1;
  }
  return sources;
}
export function readSourceVersion(root, role) {
  let commit = null, provenance = "unknown", dirty = null, inventory;
  try {
    if (path.resolve(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== path.resolve(root)) throw Error("Different repository");
    commit = git(root, ["rev-parse", "HEAD"]).trim();
    if (!shaPattern.test(commit)) throw Error("Invalid commit");
    provenance = "git";
    inventory = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  } catch {
    commit = path.basename(root).match(/^backend-([a-f0-9]{40})-/)?.[1] ?? null;
    provenance = commit ? "release-directory" : "unknown";
    inventory = walk(root);
  }
  const files = inventory.filter(file => isVersionSource(file, role));
  const read = file => {
    try { const bytes = fs.readFileSync(path.join(root, file)); return binaryAsset.test(file) ? bytes : normalize(bytes.toString("utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const sourceFingerprint = files.length ? fingerprint(files, read) : null;
  if (provenance === "git") {
    try {
      const baseline = git(root, ["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(file => file && isVersionSource(file, role));
      const sources = committedSources(root, commit, baseline);
      dirty = sourceFingerprint !== fingerprint(baseline, file => sources.get(file));
    } catch { dirty = null; }
  }
  const contracts = inventory.filter(file => contractSource(file) && !excluded.test(file) && sourceExtension.test(file));
  let contractVersion = null;
  try { contractVersion = JSON.parse(read("packages/api-contract/package.json")).version ?? null; } catch { /* unknown is explicit */ }
  return Object.freeze({ commit, provenance, dirty, sourceFingerprint, contractVersion, contractFingerprint: contracts.length ? fingerprint(contracts, read) : null });
}
/** No .git in a release archive: its release directory is the identity, not the mutable deployment checkout. */
export function captureRuntimeVersion(root, role, options = {}) {
  let source;
  try { source = readSourceVersion(root, role); }
  catch { source = { commit: null, provenance: "unknown", dirty: null, sourceFingerprint: null, contractVersion: null, contractFingerprint: null }; }
  return Object.freeze({ ...source, role, startedAt: options.startedAt ?? new Date(Date.now() - process.uptime() * 1000).toISOString(), capturedAt: new Date().toISOString() });
}
