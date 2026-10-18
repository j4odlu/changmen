// [changmen 扩展] Canonical data-layer assets -> legacy compatibility copies only.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const checksum = text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
export function inspectRdsAssetCopies(root, { write = false } = {}) {
  root = fs.realpathSync(root);
  const safe = relative => {
    const file = path.join(root, relative);
    let existing = file;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const resolved = path.relative(root, fs.realpathSync(existing));
    if (resolved === ".." || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) throw Error("RDS asset path escapes workspace");
    return file;
  };
  const baselinePath = "server/db/assets/schema-baseline.json", baselineText = fs.readFileSync(safe(baselinePath), "utf8"), baseline = JSON.parse(baselineText);
  const policy = JSON.parse(fs.readFileSync(safe("scripts/verification/retained-source-boundaries.json"), "utf8"));
  const expected = policy.groups.find(group => group.id === "rds-assets")?.baselineSha256;
  if (!expected || checksum(baselineText) !== expected) throw Error("Canonical RDS baseline differs from the retained historical contract");
  const names = Object.keys(baseline.migrations);
  if (!names.length || names.some(name => !/^\d+_[a-zA-Z0-9_]+\.sql$/.test(name))) throw Error("Invalid RDS asset manifest");
  const actual = fs.readdirSync(safe("server/db/assets/migrations")).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw Error("Canonical RDS asset manifest does not cover every SQL file");
  const pairs = [{ file: "server/backend/scripts/rds-schema-baseline.json", canonical: baselinePath },
    ...names.map(name => ({ file: `server/backend/db/migrations/${name}`, canonical: `server/db/assets/migrations/${name}` }))];
  // Validate ALL sources and destinations before writing any compatibility copy.
  for (const pair of pairs) {
    safe(pair.file);
    if (pair.canonical !== baselinePath && checksum(fs.readFileSync(safe(pair.canonical), "utf8")) !== baseline.migrations[path.posix.basename(pair.canonical)])
      throw Error(`Canonical RDS migration checksum changed: ${pair.canonical}`);
  }
  const violations = [], changed = [];
  for (const pair of pairs) {
    const from = safe(pair.canonical), to = safe(pair.file);
    if (fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;
    if (write) {
      fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); changed.push(pair.file);
    } else violations.push({ rule: "rds-asset-copy", file: pair.file, line: 0, spec: pair.canonical, pattern: "Legacy RDS asset must be a byte-identical generated copy" });
  }
  return { purpose: "rds-asset-compatibility-only", publishScopeOptimizationEnabled: false, pairs, changed, violations };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(value => !["--check", "--sync"].includes(value)) || process.argv.includes("--check") && process.argv.includes("--sync")) throw Error("Use --check (default) or explicit --sync");
  const report = inspectRdsAssetCopies(fileURLToPath(new URL("../../", import.meta.url)), { write: process.argv.includes("--sync") });
  console.log(JSON.stringify({ assets: report.pairs.length, changed: report.changed, violations: report.violations }));
  if (report.violations.length) process.exitCode = 1;
}
