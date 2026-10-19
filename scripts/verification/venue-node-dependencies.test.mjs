// [changmen 扩展] Metadata fixtures never execute application code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { inspectVenueNodeDependencies } from "./venue-node-dependencies.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("changmen-node-dependencies-")) throw Error("Unexpected cleanup target");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), "changmen-node-dependencies-"));
  scratch.push(root);
  const write = (file, pkg) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(pkg));
  };
  const main = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8"));
  write("package.json", main);
  for (const pattern of main.workspaces) {
    const dirs = pattern.endsWith("/*") ? fs.readdirSync(path.join(repository, pattern.slice(0, -2)), { withFileTypes: true })
      .filter(item => item.isDirectory()).map(item => `${pattern.slice(0, -1)}${item.name}`) : [pattern];
    for (const dir of dirs) {
      const file = `${dir}/package.json`;
      if (fs.existsSync(path.join(repository, file))) write(file, JSON.parse(fs.readFileSync(path.join(repository, file), "utf8")));
    }
  }
  for (const name of ["ob_scraper.js", "pb_scraper.mjs", "ray_scraper.js"]) {
    const file = `server/match/resolver/scrapers/${name}`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repository, file), path.join(root, file));
  }
  const bundleFile = "server/backend/scripts/test-packaged-adapter-layout.js";
  fs.mkdirSync(path.dirname(path.join(root, bundleFile)), { recursive: true });
  fs.copyFileSync(path.join(repository, bundleFile), path.join(root, bundleFile));
  return { root, edit(file, change) { const pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); change(pkg); write(file, pkg); },
    editBundle(change) { const file = path.join(root, bundleFile); fs.writeFileSync(file, change(fs.readFileSync(file, "utf8"))); },
    editSource(name, change) { const file = path.join(root, "server/match/resolver/scrapers", name); fs.writeFileSync(file, change(fs.readFileSync(file, "utf8"))); } };
}
it("keeps resolver and Node loader production declarations free from browser hosts", () => {
  const report = inspectVenueNodeDependencies(repository);
  expect(report.violations).toEqual([]);
  expect(report.closures["@changmen/team-resolver"].workspaces).not.toContain("@changmen/venue-node-loader");
  expect(report.closures["@changmen/backend"].workspaces).toContain("@changmen/venue-node-loader");
  expect(report.resolverTooling.workspaces).toContain("@changmen/venue-node-loader");
  expect(report.resolverTooling.workspaces).not.toContain("@changmen/venue-adapter");
  expect(report.backendTooling.workspaces).toHaveLength(16);
  expect(report.backendTooling.workspaces).toContain("@changmen/venue-adapter-tools");
  expect(report.backendTooling.workspaces).not.toContain("@changmen/venue-adapter");
  expect(report.bundleConsumers).toHaveLength(1);
  expect(report.consumers.map(row => [path.basename(row.file), row.kind])).toEqual([
    ["ob_scraper.js", "dynamic-import"], ["pb_scraper.mjs", "static"], ["ray_scraper.js", "dynamic-import"],
  ]);
  expect(report.installationCertified).toBe(false);
  expect(report.publishScopeOptimizationEnabled).toBe(false);
});
for (const [name, file, change] of [
  ["mixed adapter added back to backend", "server/backend/package.json", p => p.dependencies["@changmen/venue-adapter"] = "file:../../packages/venue-adapter"],
  ["optional browser consumer in resolver", "server/match/resolver/package.json", p => p.optionalDependencies = { "@changmen/pm-market-data-browser": "file:../../../packages/pm-market-data-browser" }],
  ["transitive client host in registry", "server/packages/venue-node-registry/package.json", p => p.dependencies["@changmen/client-core"] = "file:../../client-core"],
  ["transitive peer Vue in storage", "server/storage/package.json", p => p.peerDependencies = { vue: "^3.5.13" }],
  ["unknown local dependency", "server/packages/venue-node-loader/package.json", p => p.dependencies["@changmen/unknown-node"] = "file:../unknown"],
  ["browser export from Node registry", "server/packages/venue-node-registry/package.json", p => p.exports["./adapters"] = "./adapters.ts"],
  ["browser source in Node files", "server/packages/venue-node-registry/package.json", p => p.files.push("adapters.ts")],
  ["browser host in Node registry development dependencies", "server/packages/venue-node-registry/package.json", p => p.devDependencies = { "@changmen/client-core": "file:../../client-core" }],
  ["incorrect workspace location", "server/backend/package.json", p => p.dependencies["@changmen/venue-node-loader"] = "file:../../packages/venue-adapter"],
  ["Node workspace registration removed", "package.json", p => p.workspaces = p.workspaces.filter(dir => dir !== "server/packages/venue-node-registry")],
  ["registry resource declaration removed", "server/packages/venue-node-loader/package.json", p => delete p.dependencies["@changmen/venue-node-registry"]],
  ["backend facade dependency removed", "server/backend/package.json", p => delete p.dependencies["@changmen/venue-node-loader"]],
  ["resolver tooling loader removed", "server/match/resolver/package.json", p => delete p.devDependencies["@changmen/venue-node-loader"]],
  ["resolver tooling loader redirected", "server/match/resolver/package.json", p => p.devDependencies["@changmen/venue-node-loader"] = "file:../../../packages/venue-adapter"],
  ["resolver mixed development dependency", "server/match/resolver/package.json", p => p.devDependencies["@changmen/venue-adapter"] = "file:../../../packages/venue-adapter"],
  ["backend mixed development dependency", "server/backend/package.json", p => p.devDependencies["@changmen/venue-adapter"] = "file:../../packages/venue-adapter"],
  ["backend Node tool removed", "server/backend/package.json", p => delete p.devDependencies["@changmen/venue-adapter-tools"]],
  ["backend Node tool redirected", "server/backend/package.json", p => p.devDependencies["@changmen/venue-adapter-tools"] = "file:../../packages/venue-adapter"],
  ["backend manual sync changed", "server/backend/package.json", p => p.scripts["sync:platform-adapter"] = "npm run sync:backend-bundle --workspace=@changmen/venue-adapter"],
]) it(`rejects ${name}`, () => {
  const f = fixture(); f.edit(file, change);
  expect(inspectVenueNodeDependencies(f.root).violations.length).toBeGreaterThan(0);
});
for (const [name, source] of [
  ["legacy package path", 'const api=await import("@changmen/venue-adapter/loader/adapter_paths.js");'],
  ["relative source path", 'const api=await import("../../../../packages/venue-adapter/loader/adapter_paths.mjs");'],
  ["Node package deep path", 'const api=await import("@changmen/venue-node-loader/adapter_paths.mjs");'],
  ["changed initialization timing", 'import * as api from "@changmen/venue-node-loader";'],
  ["opaque replacement", 'const api=await import(target);'],
  ["mixed fallback", 'const api=await import("@changmen/venue-node-loader"); const fallback=await import("@changmen/venue-adapter/registry");'],
]) it(`rejects resolver scraper ${name}`, () => {
  const f = fixture(); f.editSource("ob_scraper.js", () => source);
  expect(inspectVenueNodeDependencies(f.root).violations.length).toBeGreaterThan(0);
});
it("includes transitive resolver tooling production peers without including unrelated development hosts", () => {
  const f = fixture(); f.edit("server/platform-probes/package.json", p => p.peerDependencies = { vue: "^3.5.13" });
  const report = inspectVenueNodeDependencies(f.root);
  expect(report.resolverTooling.directExternalPackages).toContain("vue");
  expect(report.violations.some(row => row.pattern.includes("resolver tooling closure"))).toBe(true);
});

for (const [file, target] of [
  ["server/backend/package.json", "file:../../client/packages/venue-browser"],
  ["server/match/resolver/package.json", "file:../../../client/packages/venue-browser"],
]) for (const group of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"])
  it(`rejects the browser workspace itself through ${file} ${group}`, () => {
    const f = fixture();
    f.edit(file, p => { p[group] = { ...p[group], "@changmen/venue-browser": target }; });
    expect(inspectVenueNodeDependencies(f.root).violations.some(row => row.file === file
      && row.spec === "@changmen/venue-browser" && row.pattern.includes(`through ${group}`))).toBe(true);
  });

it("rejects the browser workspace in transitive Node production dependencies", () => {
  const f = fixture();
  f.edit("server/storage/package.json", p => {
    p.optionalDependencies = { "@changmen/venue-browser": "file:../../client/packages/venue-browser" };
  });
  expect(inspectVenueNodeDependencies(f.root).violations.some(row => row.file === "server/storage/package.json"
    && row.spec === "@changmen/venue-browser" && row.pattern.includes("Node production closure"))).toBe(true);
});
for (const [name, source] of [
  ["relative tool source", 'import {syncPlatformAdapterBackendBundle} from "../../../packages/venue-adapter/scripts/sync-backend-bundle.mjs";'],
  ["mixed package", 'import "@changmen/venue-adapter";'],
  ["dynamic timing", 'const tool=await import("@changmen/venue-adapter-tools/sync-backend-bundle.mjs");'],
  ["mixed fallback", 'import "@changmen/venue-adapter-tools/sync-backend-bundle.mjs";import "@changmen/venue-adapter/registry";'],
]) it(`rejects backend bundle consumer ${name}`, () => {
  const f = fixture(); f.editBundle(() => source);
  expect(inspectVenueNodeDependencies(f.root).violations.length).toBeGreaterThan(0);
});
