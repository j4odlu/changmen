// Current architectural invariants; no Git baselines, source restoration or trading snapshots.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const sha = text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
export function inspectCurrentSourceBoundaries(root) {
  root = fs.realpathSync(root);
  const safe = file => {
    if (typeof file !== "string" || !file || path.isAbsolute(file) || file.includes("\\") || file.split("/").includes(".."))
      throw Error("Invalid current boundary path");
    return path.join(root, file);
  };
  const read = file => {
    const target = fs.realpathSync(safe(file)), relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw Error("Current boundary escapes workspace");
    return fs.readFileSync(target, "utf8");
  };
  const json = file => JSON.parse(read(file)), violations = [];
  const fail = (file, pattern) => violations.push({ rule: "current-source-boundary", file, line: 0, spec: "current contract", pattern });
  const workspace = json("scripts/verification/workspace-layout-relocation.json");
  const node = json("scripts/verification/node-entry-retirement.json");
  const browser = json("scripts/verification/browser-entry-retirement.json");
  const rds = json("scripts/verification/rds-entry-retirement.json");
  const probes = json("scripts/verification/backend-probe-relocation.json");
  const legacy = json("scripts/verification/rds-legacy-relocation.json");
  const maintenance = json("scripts/verification/rds-maintenance-relocation.json");
  const sdk = json("scripts/verification/pm-sdk-retirement.json");
  const credentials = json("scripts/verification/pm-credential-sdk-increments.json");
  const retired = new Set([
    ...workspace.files.filter(row => row.file !== row.canonical).map(row => row.file),
    ...node.removed.map(row => row.file), ...browser.retired, ...rds.entries.map(row => row.file),
    ...probes.moves.map(row => row.file), ...legacy.moves.map(row => row.file), ...maintenance.moves.map(row => row.file),
    ...sdk.files.filter(row => row.afterSha === null).map(row => row.file), ...credentials.retired.map(row => row.file),
    "server/backend/scripts/rds-schema-baseline.json",
  ]);
  for (const file of retired) if (file.startsWith("client/packages/venue-browser/adapter/")) retired.add(file.replace("/adapter/", "/"));
  for (const file of retired) if (fs.lstatSync(safe(file), { throwIfNoEntry: false })) fail(file, "Retired source entry must not return");
  const scanRetiredRoot = directory => {
    if (!fs.existsSync(safe(directory))) return;
    for (const item of fs.readdirSync(safe(directory), { withFileTypes: true })) {
      if (item.name.startsWith(".") || ["node_modules", "dist", "coverage"].includes(item.name)) continue;
      const file = directory + "/" + item.name;
      if (item.isDirectory()) scanRetiredRoot(file);
      else if (/\.(?:[cm]?[jt]s|sql|json)$/.test(item.name)) fail(file, "Source must live in the current RDS root");
    }
  };
  for (const directory of ["server/backend/db", "server/db"]) scanRetiredRoot(directory);

  // The old forwarding entries remain forwarding entries, but the canonical
  // implementation may evolve freely. Compare targets, never implementation hashes.
  const adapter = json("scripts/verification/adapter-browser-relocation.json");
  const oldEntries = new Map(adapter.records.map(row => [row.file, row.canonical])), facades = new Map(), redirectedFacades = new Map();
  for (const name of fs.readdirSync(safe("scripts/verification")).filter(name => /^venue-browser-.*\.json$/.test(name))) {
    const record = json("scripts/verification/" + name);
    for (const row of record.rows ?? []) {
      const from = oldEntries.get(row.file);
      if (from && from !== row.canonical) facades.set(from, row.canonical);
    }
    const added = new Set((record.added ?? []).map(row => row.file));
    for (const row of record.changes ?? []) {
      const target = row.file?.replace(/^packages\/venue-adapter\//, "client/packages/venue-browser/");
      const from = oldEntries.get(row.file);
      if (from && from !== target && added.has(target)) facades.set(from, target);
      if (from) for (const source of [...(row.replacements ?? []).map(replacement => replacement.to),
        (row.patches ?? []).flatMap(patch => patch.after ?? []).join("\n")]) {
        const match = /^\s*export\s+\*\s+from\s+["']([^"']+)["'];?\s*$/.exec(source ?? "");
        if (!match) continue;
        let redirected;
        if (match[1].startsWith("@changmen/venue-browser/")) redirected = "client/packages/venue-browser/" + match[1].slice("@changmen/venue-browser/".length);
        else if (match[1].startsWith(".")) {
          let oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(row.file), match[1]));
          if (!/\.[cm]?[jt]s$/.test(oldTarget)) oldTarget += ".ts";
          redirected = oldEntries.get(oldTarget) ?? oldTarget.replace(/^packages\/venue-adapter\//, "client/packages/venue-browser/adapter/");
        }
        if (redirected) redirectedFacades.set(from, /\.[cm]?[jt]s$/.test(redirected) ? redirected : redirected + ".ts");
      }
    }
  }
  for (const [file, target] of redirectedFacades) if (facades.has(file)) facades.set(file, target);
  const forwardingTarget = file => {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "").trim();
    const match = /^export\s+\*\s+from\s+["']([^"']+)["'];?$/.exec(source);
    if (!match) return null;
    let target;
    if (match[1].startsWith("@changmen/venue-browser/")) target = "client/packages/venue-browser/" + match[1].slice("@changmen/venue-browser/".length);
    else if (match[1].startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    else throw Error("Unexpected forwarding package");
    return /\.[cm]?[jt]s$/.test(target) ? target : target + ".ts";
  };
  const finalTarget = file => {
    const seen = new Set();
    for (;;) {
      if (seen.has(file)) throw Error("Circular forwarding entries");
      seen.add(file); const target = forwardingTarget(file);
      if (!target) return file;
      file = target;
    }
  };
  for (const [file, canonical] of facades) try {
    if (!forwardingTarget(file) || finalTarget(file) !== finalTarget(canonical)) fail(file, "Compatibility facade must forward only to its current canonical implementation");
  } catch (error) { fail(file, "Invalid compatibility facade: " + error.message); }

  // Deployed SQL migrations remain immutable even though application implementations evolve.
  const policy = json("scripts/verification/retained-source-boundaries.json");
  const baselineFile = "rds/assets/schema-baseline.json", text = read(baselineFile), baseline = JSON.parse(text);
  if (sha(text) !== policy.groups.find(group => group.id === "rds-assets")?.baselineSha256) fail(baselineFile, "SQL baseline changed");
  const names = Object.keys(baseline.migrations);
  if (!names.length || names.some(name => !/^\d+_[A-Za-z0-9_]+\.sql$/.test(name))) throw Error("Invalid SQL asset manifest");
  const actual = fs.readdirSync(safe("rds/assets/migrations")).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) fail(baselineFile, "SQL manifest must cover every migration");
  for (const name of names) {
    const file = "rds/assets/migrations/" + name;
    if (sha(read(file)) !== baseline.migrations[name]) fail(file, "Deployed SQL migration checksum changed");
  }
  if (json("scripts/verification/backend-db-access-exceptions.json").sites.length)
    fail("scripts/verification/backend-db-access-exceptions.json", "Retired database access exceptions must not return");
  return { retiredPaths: retired.size, facades: facades.size, sqlAssets: names.length + 1, violations };
}
