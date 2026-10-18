// [changmen 扩展] Offline resolution against an explicitly selected installation.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const relative = (root, file) => path.relative(root, file).replaceAll("\\", "/");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function resolution(root, input, mode, id) {
  if (!id || id.startsWith("\0")) throw Error(`Unresolved/virtual PM input: ${input.spec}`);
  const file = id.startsWith("file:") ? fileURLToPath(id) : id.split("?")[0];
  const real = fs.realpathSync(file), rel = relative(root, real);
  if (rel.startsWith("../") || path.isAbsolute(rel)) throw Error(`Resolution escapes selected installation: ${real}`);
  let owner;
  for (let dir = path.dirname(real); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) { owner = JSON.parse(fs.readFileSync(manifest, "utf8")); break; }
    if (dir === root || dir === path.dirname(dir)) break;
  }
  return { importer: input.importer, spec: input.spec, mode, target: rel, sha256: hash(real), package: owner?.name, version: owner?.version };
}

export function comparePmInstallResolutions(before, after) {
  if (before.schemaVersion !== 1 || after.schemaVersion !== 1 || before.node !== after.node || !before.vueShared || !after.vueShared
    || !before.resolutions.length || !after.resolutions.length) throw Error("Incompatible or incomplete resolution evidence");
  const key = row => JSON.stringify([row.importer, row.spec, row.mode]);
  const old = new Map(before.resolutions.map(row => [key(row), row]));
  const current = new Map(after.resolutions.map(row => [key(row), row]));
  if (old.size !== before.resolutions.length || current.size !== after.resolutions.length) throw Error("Duplicate resolution evidence");
  return [...new Set([...old.keys(), ...current.keys()])].filter(k => JSON.stringify(old.get(k)) !== JSON.stringify(current.get(k)))
    .map(k => ({ key: JSON.parse(k), before: old.get(k), after: current.get(k) }));
}

export async function capturePmInstallResolutions(root, inputs) {
  root = fs.realpathSync(root);
  for (const input of inputs) {
    if (!["node", "browser"].includes(input.environment) || !input.spec || !input.importer || path.isAbsolute(input.importer)
      || input.importer.split(/[\\/]/).includes("..")) throw Error("Invalid PM resolution input");
  }
  const resolutions = [], requireFromRoot = createRequire(path.join(root, "package.json"));
  for (const input of inputs) {
    const importer = path.join(root, input.importer);
    if (input.environment === "node") {
      const code = `console.log(JSON.stringify(import.meta.resolve(${JSON.stringify(input.spec)})))`;
      const id = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: path.dirname(importer), encoding: "utf8", windowsHide: true }));
      resolutions.push(resolution(root, input, "node-esm", id));
      resolutions.push(resolution(root, input, "node-cjs", createRequire(importer).resolve(input.spec)));
    }
  }
  const { createServer } = await import(pathToFileURL(requireFromRoot.resolve("vite")).href);
  // Actual project aliases and browser HMAC plugin; no HTTP listener, HMR, source watcher,
  // or dependency prebundling. This proves resolution, not a production bundle.
  const server = await createServer({
    root: path.join(root, "client/web"), configFile: path.join(root, "client/web/vite.config.ts"), mode: "production",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "pm-resolution-no-prebundle", enforce: "post", configResolved(config) {
      config.optimizeDeps.noDiscovery = true; config.optimizeDeps.include = [];
      config.environments.client.optimizeDeps.noDiscovery = true; config.environments.client.optimizeDeps.include = [];
    } }],
  });
  try {
    for (const input of inputs.filter(row => row.environment === "browser")) {
      const found = await server.environments.client.pluginContainer.resolveId(input.spec, path.join(root, input.importer));
      resolutions.push(resolution(root, input, "vite-client", found?.id));
    }
  } finally { await server.close(); }
  const vue = resolutions.filter(row => row.mode === "vite-client" && row.spec === "vue");
  if (vue.length < 2 || new Set(vue.map(row => row.target)).size !== 1) throw Error("Web host and PM adapter must resolve one Vue runtime");
  return { schemaVersion: 1, node: process.version, resolutions, vueShared: true, productionBundleCertified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, i, all) => value.startsWith("--") ? [...rows, [value.slice(2), all[i + 1]]] : rows, []));
  if (!args.root || !args.inputs || !args.output) throw Error("Usage: --root INSTALL_ROOT --inputs INPUTS_JSON --output REPORT_JSON");
  const report = await capturePmInstallResolutions(path.resolve(args.root), JSON.parse(fs.readFileSync(args.inputs, "utf8")));
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ resolutions: report.resolutions.length, vueShared: report.vueShared }));
}
