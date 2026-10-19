// [changmen 扩展] One authored catalog, byte-identical compatibility assets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VENUE_MANIFEST_SOURCE = "packages/shared/catalog/venue_manifest.json";
export const VENUE_MANIFEST_COPIES = Object.freeze([
  "packages/venue-adapter/registry/manifest.json",
  "server/packages/venue-node-registry/manifest.json",
  "server/packages/venue-node-registry/runtime/registry/manifest.json",
]);

export function inspectVenueManifestCopies(root, { write = false } = {}) {
  root = fs.realpathSync(root);
  const safe = relative => {
    const target = path.join(root, relative);
    let existing = target;
    while (!fs.lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
    const resolved = path.relative(root, fs.realpathSync(existing));
    if (resolved === ".." || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved))
      throw Error(`Venue manifest path escapes workspace: ${relative}`);
    if (fs.existsSync(target) && !fs.statSync(target).isFile())
      throw Error(`Venue manifest must be a file: ${relative}`);
    return target;
  };
  // Resolve every destination and parse the only source before writing anything.
  const shared = JSON.parse(fs.readFileSync(safe("packages/shared/package.json"), "utf8"));
  if (shared.exports?.["./catalog/venue_manifest.json"] !== "./catalog/venue_manifest.json")
    throw Error("Shared venue manifest public export must point to the canonical asset");
  const source = fs.readFileSync(safe(VENUE_MANIFEST_SOURCE));
  if (!Array.isArray(JSON.parse(source.toString("utf8")))) throw Error("Venue manifest source must be an array");
  const destinations = VENUE_MANIFEST_COPIES.map(file => ({ file, absolute: safe(file) }));
  const changed = [], violations = [];
  for (const { file, absolute } of destinations) {
    if (fs.existsSync(absolute) && fs.readFileSync(absolute).equals(source)) continue;
    if (write) {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, source);
      changed.push(file);
    } else violations.push({ file, source: VENUE_MANIFEST_SOURCE, reason: "Missing or stale generated venue manifest; run npm run sync:venue-manifest" });
  }
  return { source: VENUE_MANIFEST_SOURCE, copies: VENUE_MANIFEST_COPIES, changed, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !["--check", "--sync"].includes(arg))) throw Error("Use --check (default) or --sync");
  const report = inspectVenueManifestCopies(fileURLToPath(new URL("../../", import.meta.url)), { write: args[0] === "--sync" });
  console.log(JSON.stringify(report));
  if (report.violations.length) process.exitCode = 1;
}
