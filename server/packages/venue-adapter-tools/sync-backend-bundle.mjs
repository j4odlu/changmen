#!/usr/bin/env node
/** [changmen 扩展] Build a self-contained Node artifact from the server-owned resource root. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKEND_ROOT, VENUE_ADAPTER_ROOT } from "@changmen/storage/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// A copied artifact owns registry/paths.js beside scripts/. A workspace tool uses
// the registry package's declared resource tree, even if its generated catalog is stale.
const ADAPTER_PKG_ROOT = fs.existsSync(path.join(__dirname, "../registry/paths.js"))
  ? path.resolve(__dirname, "..") : VENUE_ADAPTER_ROOT;
const LEGACY_TOOL_FACADE = "#!/usr/bin/env node\nimport path from \"node:path\";\nimport { pathToFileURL } from \"node:url\";\nimport { syncPlatformAdapterBackendBundle } from \"../../../server/packages/venue-adapter-tools/sync-backend-bundle.mjs\";\nexport * from \"../../../server/packages/venue-adapter-tools/sync-backend-bundle.mjs\";\n\nif (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {\n  console.log(`[sync-platform-adapter] ${syncPlatformAdapterBackendBundle()}`);\n}\n";
const ADAPTER_INFRA = new Set(["registry", "loader", "shared", "contract", "scripts", "_template", "node_modules"]);
const ENTRIES = [
  ["loader/adapter_paths.mjs", "@changmen/venue-node-loader", [
    'export * from "../../../server/packages/venue-node-loader/adapter_paths.mjs";\n',
  ]],
  ["registry/paths.js", "@changmen/venue-node-registry/paths.js", [
    'export * from "../../paths.js";\n',
    'export * from "../../../server/packages/venue-node-registry/paths.js";\n',
  ]],
  ["registry/feeds.js", "@changmen/venue-node-registry/feeds.js", [
    'export * from "../../feeds.js";\n',
    'export * from "../../../server/packages/venue-node-registry/feeds.js";\n',
  ]],
  ["scripts/sync-backend-bundle.mjs", null, [LEGACY_TOOL_FACADE]],
];
function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "_template") continue;
    const from = path.join(src, name), to = path.join(dst, name);
    if (fs.statSync(from).isDirectory()) cpDir(from, to);
    else fs.copyFileSync(from, to);
  }
}
/** @param {{dst?: string, src?: string, includeBrowserSources?: boolean}} [options] */
export function syncPlatformAdapterBackendBundle(options = {}) {
  const src = options.src ?? ADAPTER_PKG_ROOT;
  const dst = options.dst ?? path.join(BACKEND_ROOT, "platform_adapter");
  const isDefault = path.resolve(src) === path.resolve(ADAPTER_PKG_ROOT);
  const manifestSource = isDefault ? require.resolve("@changmen/shared/catalog/venue_manifest.json")
    : path.join(src, "registry", "manifest.json");
  if (!fs.existsSync(manifestSource)) throw new Error(`platform-adapter source missing manifest: ${src}`);
  const manifestBytes = fs.readFileSync(manifestSource);
  const realSource = fs.realpathSync(src), target = fs.existsSync(dst) ? fs.realpathSync(dst) : path.resolve(dst);
  const contains = (a, b) => { const rel = path.relative(a, b); return !rel || rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel); };
  if (contains(realSource, target) || contains(target, realSource)) throw Error("Bundle source and destination must not overlap");
  // Resolve all required implementation bytes before replacing an existing artifact.
  const materialized = [];
  for (const [relative, spec, facades] of ENTRIES) {
    const input = path.join(src, relative), present = fs.existsSync(input);
    if (!present && !isDefault) continue;
    if (present && !facades.includes(fs.readFileSync(input, "utf8").replaceAll("\r\n", "\n"))) continue;
    const implementation = spec ? require.resolve(spec) : fileURLToPath(import.meta.url);
    materialized.push([relative, fs.readFileSync(implementation)]);
  }
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "_template") continue;
    const from = path.join(src, name), to = path.join(dst, name);
    if (!fs.statSync(from).isDirectory()) fs.copyFileSync(from, to);
    else if (ADAPTER_INFRA.has(name) || options.includeBrowserSources) cpDir(from, to);
  }
  for (const [relative, bytes] of materialized) {
    const target = path.join(dst, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  fs.mkdirSync(path.join(dst, "registry"), { recursive: true });
  fs.writeFileSync(path.join(dst, "registry", "manifest.json"), manifestBytes);
  return dst;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`[sync-platform-adapter] ${syncPlatformAdapterBackendBundle()}`);
}
