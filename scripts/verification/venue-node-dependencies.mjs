// [changmen 扩展] Declared Node workspace closure only; not a deployment selector.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentImportSites } from "./component-entry-boundary.mjs";
import { declaredInstallClosure } from "./component-install-inputs.mjs";

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const forbidden = new Set(["@changmen/venue-adapter", "@changmen/pm-market-data-browser", "@changmen/venue-browser", "@changmen/client-core", "vue", "pinia"]);
const resolverConsumers = {
  "server/match/resolver/scrapers/ob_scraper.js": "dynamic-import",
  "server/match/resolver/scrapers/pb_scraper.mjs": "static",
  "server/match/resolver/scrapers/ray_scraper.js": "dynamic-import",
};
const nodeEntries = {
  "server/packages/venue-node-loader": {
    name: "@changmen/venue-node-loader",
    exports: { ".": "./adapter_paths.mjs", "./adapter_paths.js": "./adapter_paths.mjs", "./adapter_paths.mjs": "./adapter_paths.mjs" },
    files: ["adapter_paths.mjs"],
    dependencies: {
      "@changmen/platform-probes": "file:../../platform-probes",
      "@changmen/shared": "file:../../../packages/shared",
      "@changmen/storage": "file:../../storage",
      "@changmen/venue-node-registry": "file:../venue-node-registry",
    },
  },
  "server/packages/venue-node-registry": {
    name: "@changmen/venue-node-registry",
    exports: { "./paths.js": "./paths.js", "./feeds.js": "./feeds.js", "./manifest.json": "./manifest.json" },
    files: ["paths.js", "feeds.js", "manifest.json", "runtime"],
    dependencies: { "@changmen/storage": "file:../../storage" },
  },
};

export function inspectVenueNodeDependencies(root) {
  const packages = new Map(), violations = [];
  const fail = (file, spec, pattern) => violations.push({ rule: "venue-node-install", file, line: 0, spec, pattern });
  for (const pattern of read(path.join(root, "package.json")).workspaces) {
    if (pattern.includes("*") && !pattern.endsWith("/*")) throw Error(`Unsupported workspace pattern: ${pattern}`);
    const dirs = pattern.endsWith("/*") ? fs.readdirSync(path.join(root, pattern.slice(0, -2)), { withFileTypes: true })
      .filter(item => item.isDirectory()).map(item => `${pattern.slice(0, -1)}${item.name}`) : [pattern];
    for (const dir of dirs) {
      const file = `${dir}/package.json`;
      if (!fs.existsSync(path.join(root, file))) continue;
      const pkg = read(path.join(root, file));
      if (!pkg.name || packages.has(pkg.name)) throw Error(`Invalid/duplicate workspace: ${file}`);
      packages.set(pkg.name, { dir, file, pkg });
    }
  }
  for (const [dir, expected] of Object.entries(nodeEntries)) {
    const item = packages.get(expected.name);
    if (!item || item.dir !== dir) { fail(`${dir}/package.json`, expected.name, "Node workspace must keep the original protected source location"); continue; }
    const { pkg, file } = item;
    if (JSON.stringify(pkg.exports) !== JSON.stringify(expected.exports) || JSON.stringify(pkg.files) !== JSON.stringify(expected.files)
      || pkg.type !== "module") fail(file, expected.name, "Node exports/files must contain only the reviewed original implementation and manifest");
    if (JSON.stringify(pkg.dependencies) !== JSON.stringify(expected.dependencies))
      fail(file, expected.name, "Node loader and registry must declare their reviewed runtime resources directly");
    if (expected.name === "@changmen/venue-node-registry" && pkg.devDependencies && Object.keys(pkg.devDependencies).length)
      fail(file, expected.name, "Adjacent browser TypeScript hosts belong to the parent browser adapter, not the Node registry development install");
  }
  const backend = packages.get("@changmen/backend");
  if (backend?.pkg.dependencies?.["@changmen/venue-node-loader"] !== "file:../packages/venue-node-loader")
    fail("server/backend/package.json", "@changmen/venue-node-loader", "The backend facade requires its own production Node loader declaration");
  if (backend?.pkg.devDependencies?.["@changmen/venue-adapter-tools"] !== "file:../packages/venue-adapter-tools")
    fail("server/backend/package.json", "@changmen/venue-adapter-tools", "Backend bundle validation must declare its existing Node tool workspace");
  if (backend?.pkg.scripts?.["sync:platform-adapter"] !== "npm run sync:backend-bundle --workspace=@changmen/venue-adapter-tools && npm run sync:backend-bundle --workspace=@changmen/platform-probes")
    fail("server/backend/package.json", "sync:platform-adapter", "Backend manual sync must keep the original adapter-then-probes sequence through the Node tool owner");
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    for (const name of forbidden) if (backend?.pkg[group]?.[name])
      fail("server/backend/package.json", name, `Backend must not pull browser/mixed hosts through ${group}`);
  const bundleConsumerFile = "server/backend/scripts/test-packaged-adapter-layout.js";
  const bundleSites = fs.existsSync(path.join(root, bundleConsumerFile))
    ? componentImportSites(bundleConsumerFile, fs.readFileSync(path.join(root, bundleConsumerFile), "utf8")) : [];
  const bundleConsumers = bundleSites.filter(site => site.spec === "@changmen/venue-adapter-tools/sync-backend-bundle.mjs");
  if (bundleConsumers.length !== 1 || bundleConsumers[0].kind !== "static")
    fail(bundleConsumerFile, "@changmen/venue-adapter-tools", "Packaged layout validation must statically import the original Node tool export");
  for (const site of bundleSites) {
    if (!site.spec) continue;
    const relative = site.spec.startsWith(".") ? path.relative(root, path.resolve(root, path.dirname(bundleConsumerFile), site.spec)).replaceAll("\\", "/") : "";
    if (/^@changmen\/venue-adapter(?:\/|$)/.test(site.spec) || /^packages\/venue-adapter(?:\/|$)/.test(relative))
      fail(bundleConsumerFile, site.spec, "Backend bundle validation cannot bypass its Node tool owner through the mixed package/source");
  }
  const resolver = packages.get("@changmen/team-resolver");
  if (resolver?.pkg.devDependencies?.["@changmen/venue-node-loader"] !== "file:../../packages/venue-node-loader")
    fail("server/match/resolver/package.json", "@changmen/venue-node-loader", "Resolver scraper tools must declare the original Node loader as a development dependency");
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    for (const name of forbidden) if (resolver?.pkg[group]?.[name])
      fail("server/match/resolver/package.json", name, `Resolver must not pull browser/mixed hosts through ${group}`);
  const consumers = [];
  for (const [file, kind] of Object.entries(resolverConsumers)) {
    if (!fs.existsSync(path.join(root, file))) { fail(file, "@changmen/venue-node-loader", "Missing reviewed resolver scraper"); continue; }
    const sites = componentImportSites(file, fs.readFileSync(path.join(root, file), "utf8"));
    const entries = sites.filter(site => site.spec === "@changmen/venue-node-loader");
    if (entries.length !== 1 || entries[0].kind !== kind)
      fail(file, "@changmen/venue-node-loader", "Scraper must keep its original static/dynamic loading timing through the Node package root");
    for (const site of sites) {
      if (!site.spec) continue; // Existing component/loader gates retain unknown-path handling.
      const relative = site.spec.startsWith(".") ? path.relative(root, path.resolve(root, path.dirname(file), site.spec)).replaceAll("\\", "/") : "";
      if (/^@changmen\/venue-adapter(?:\/|$)/.test(site.spec)
        || /^@changmen\/venue-node-loader\//.test(site.spec)
        || /^packages\/venue-adapter(?:\/|$)/.test(relative))
        fail(file, site.spec, "Resolver scraper cannot bypass its declared Node loader with a mixed-package or source-path import");
    }
    consumers.push(...entries);
  }
  const closures = {};
  for (const name of ["@changmen/backend", "@changmen/team-resolver", "@changmen/venue-node-loader"]) {
    const seen = new Set(), external = new Set(), queue = [{ name, via: [name] }];
    while (queue.length) {
      const item = queue.shift();
      if (seen.has(item.name)) continue;
      const owner = packages.get(item.name);
      if (!owner) throw Error(`Missing Node workspace: ${item.name}`);
      seen.add(item.name);
      // Include optional/peer declarations conservatively. Dev tooling is excluded.
      const dependencies = Object.assign({}, owner.pkg.dependencies, owner.pkg.optionalDependencies, owner.pkg.peerDependencies);
      for (const [dep, range] of Object.entries(dependencies)) {
        const via = [...item.via, dep];
        if (forbidden.has(dep)) fail(owner.file, dep, `Browser/mixed package in declared Node production closure: ${via.join(" -> ")}`);
        const target = packages.get(dep);
        if (target) {
          if (!range.startsWith("file:") || path.resolve(root, owner.dir, range.slice(5)) !== path.resolve(root, target.dir))
            fail(owner.file, dep, "Workspace dependency must resolve to its declared local source");
          if (!forbidden.has(dep)) queue.push({ name: dep, via });
        } else if (dep.startsWith("@changmen/") || range.startsWith("file:")) fail(owner.file, dep, "Unknown local production dependency cannot certify Node isolation");
        else external.add(dep);
      }
    }
    closures[name] = { workspaces: [...seen].sort(), directExternalPackages: [...external].sort() };
  }
  // Only the resolver root's development declarations are included, never unrelated tools.
  const resolverTooling = declaredInstallClosure(root, packages, "@changmen/team-resolver", { build: true });
  violations.push(...resolverTooling.violations.map(row => ({ rule: "venue-node-install", line: 0, ...row })));
  for (const edge of resolverTooling.edges) if (forbidden.has(edge.name))
    fail(`${edge.from}/package.json`, edge.name, `Browser/mixed package in resolver tooling closure: ${edge.via.join(" -> ")}`);
  const backendTooling = declaredInstallClosure(root, packages, "@changmen/backend", { build: true });
  violations.push(...backendTooling.violations.map(row => ({ rule: "venue-node-install", line: 0, ...row })));
  for (const edge of backendTooling.edges) if (forbidden.has(edge.name))
    fail(`${edge.from}/package.json`, edge.name, `Browser/mixed package in backend tooling closure: ${edge.via.join(" -> ")}`);
  return { schemaVersion: 1, purpose: "node-declaration-boundary-only", publishScopeOptimizationEnabled: false,
    installationCertified: false, closures, resolverTooling, consumers, backendTooling, bundleConsumers, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectVenueNodeDependencies(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  console.log(JSON.stringify(report, null, 2));
  if (report.violations.length) process.exitCode = 1;
}
