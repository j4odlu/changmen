// [changmen 扩展] Analyze metadata without executing installers or application modules.
import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { declaredInstallClosure, frontendInstallBoundary, inspectComponentInstallInputs, readInstallWorkspaces, venueBrowserDeclarationBoundary, runtimeToolingDeclarationBoundary } from "./component-install-inputs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
it("reports real frontend/backend/RDS declarations without claiming installation isolation", () => {
  const report = inspectComponentInstallInputs(root);
  expect(report.violations).toEqual([]); expect(report.profiles.frontend.workspaces).toHaveLength(7);
  expect(report.profiles.backend.workspaces).toHaveLength(15); expect(report.profiles.rds.workspaces).toHaveLength(4);
  expect(report.profiles.backend.workspaces).not.toContain("@changmen/venue-adapter");
  expect(report.frontendBackendEdges).toEqual([]); expect(report.frontendDeclarationsIsolated).toBe(true);
  expect(report.profiles.frontend.build.directExternalPackages).toContain("vite");
  expect(report.profiles.frontend.directExternalPackages).not.toContain("vite");
  expect(report.profiles.frontend.workspaces).not.toContain("@changmen/runtime-tooling");
  expect(report.profiles.frontend.build.workspaces).toContain("@changmen/runtime-tooling");
  expect(report.profiles.backend.workspaces).toContain("@changmen/runtime-tooling");
  expect(report.installationCertified).toBe(false); expect(report.publishScopeOptimizationEnabled).toBe(false);
});
for (const group of ["dependencies", "optionalDependencies", "peerDependencies"])
  it(`rejects moving the Node build tool into frontend runtime ${group}`, () => {
    const packages = readInstallWorkspaces(root), web = packages.get("@changmen/web").pkg;
    web[group] = { ...web[group], "@changmen/runtime-tooling": "file:../../devtools/runtime-tooling" };
    expect(frontendInstallBoundary(declaredInstallClosure(root, packages, "@changmen/web", { build: true }))
      .some(row => row.spec === "@changmen/runtime-tooling")).toBe(true);
  });
for (const [label, edit] of [
  ["tool adds a Node/data dependency", packages => { packages.get("@changmen/runtime-tooling").pkg.dependencies = { "@changmen/db": "file:../../server/db" }; }],
  ["tool adds a lifecycle script", packages => { packages.get("@changmen/runtime-tooling").pkg.scripts = { postinstall: "node unsafe.js" }; }],
  ["shared adds even an optional Node peer", packages => { packages.get("@changmen/shared").pkg.peerDependencies = { "@changmen/runtime-tooling": "file:../../devtools/runtime-tooling" }; }],
  ["legacy owner redirects the runtime dependency", packages => { packages.get("@changmen/runtime-tooling-compat").pkg.dependencies["@changmen/runtime-tooling"] = "file:../../../server/db"; }],
  ["server drops its runtime owner", packages => { delete packages.get("@changmen/storage").pkg.dependencies["@changmen/runtime-tooling"]; }],
  ["web drops its build owner", packages => { delete packages.get("@changmen/web").pkg.devDependencies["@changmen/runtime-tooling"]; }],
]) it(`rejects ${label}`, () => {
  const packages = readInstallWorkspaces(root); edit(packages);
  expect(runtimeToolingDeclarationBoundary(packages).length).toBeGreaterThan(0);
});
it("keeps shared free of Node declarations while the explicit legacy workspace owns its dependency", () => {
  const packages = readInstallWorkspaces(root), profile = declaredInstallClosure(root, packages, "@changmen/shared");
  expect(profile.workspaces).toEqual(["@changmen/shared"]);
  expect(profile.edges).toEqual([]);
  expect(declaredInstallClosure(root, packages, "@changmen/runtime-tooling-compat").workspaces)
    .toEqual(["@changmen/runtime-tooling", "@changmen/runtime-tooling-compat"]);
});
for (const [name, target] of [["@changmen/db", "server/db"], ["@changmen/storage", "server/storage"],
  ["@changmen/venue-node-loader", "packages/venue-adapter/loader"], ["@changmen/venue-node-registry", "packages/venue-adapter/registry"],
  ["@changmen/venue-adapter-tools", "packages/venue-adapter/scripts"], ["@changmen/runtime-tooling-compat", "packages/shared/tooling"]]) {
  it(`rejects an indirect frontend install edge to ${name}`, () => {
    const packages = readInstallWorkspaces(root);
    packages.get("@changmen/shared").pkg.dependencies = { [name]: `file:../../${target}` };
    const profile = declaredInstallClosure(root, packages, "@changmen/web", { build: true });
    expect(frontendInstallBoundary(profile).some(row => row.spec === name && row.pattern.includes("@changmen/web -> @changmen/shared"))).toBe(true);
  });
}
for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  it(`rejects reintroducing storage into adapter ${group}`, () => {
    const packages = readInstallWorkspaces(root), pkg = packages.get("@changmen/venue-adapter").pkg;
    pkg[group] = { ...pkg[group], "@changmen/storage": "file:../../server/storage" };
    expect(venueBrowserDeclarationBoundary(packages).some(row => row.spec === "@changmen/storage")).toBe(true);
  });
}
it("rejects a missing or redirected tool owner while keeping old loader exports unchanged", () => {
  const packages = readInstallWorkspaces(root), adapter = packages.get("@changmen/venue-adapter").pkg;
  expect(adapter.exports["./loader/adapter_paths.js"]).toBe("./loader/adapter_paths.mjs");
  expect(adapter.exports["./loader/adapter_paths.mjs"]).toBe("./loader/adapter_paths.mjs");
  packages.get("@changmen/venue-adapter-tools").pkg.dependencies["@changmen/storage"] = "file:../../../server/db";
  expect(venueBrowserDeclarationBoundary(packages)).toHaveLength(1);
  packages.delete("@changmen/venue-adapter-tools");
  expect(venueBrowserDeclarationBoundary(packages)).toHaveLength(1);
});
it("rejects a Node tool CLI that redirects the unchanged bundle implementation", () => {
  const packages = readInstallWorkspaces(root);
  packages.get("@changmen/venue-adapter-tools").pkg.scripts["sync:backend-bundle"] = "node ../registry/adapters.ts";
  expect(venueBrowserDeclarationBoundary(packages)).toHaveLength(1);
});
it("keeps browser registry type hosts declared by their actual browser adapter owner", () => {
  const packages = readInstallWorkspaces(root);
  delete packages.get("@changmen/venue-adapter").pkg.dependencies["@changmen/client-core"];
  expect(venueBrowserDeclarationBoundary(packages).some(row => row.spec === "@changmen/client-core")).toBe(true);
});
it("includes optional and peer declarations, excludes other workspaces' development tools", () => {
  const packages = readInstallWorkspaces(root);
  packages.get("@changmen/storage").pkg.optionalDependencies = { "@changmen/client-core": "file:../../packages/client-core" };
  packages.get("@changmen/storage").pkg.peerDependencies = { vue: "^3.5.13" };
  const report = declaredInstallClosure(root, packages, "@changmen/db");
  expect(report.workspaces).toContain("@changmen/client-core"); expect(report.directExternalPackages).toContain("vue");
  expect(report.directExternalPackages).not.toContain("vitest");
});
it("terminates local dependency cycles and retains a reviewable dependency chain", () => {
  const packages = readInstallWorkspaces(root);
  packages.get("@changmen/shared").pkg.dependencies = { "@changmen/db": "file:../../server/db" };
  const report = declaredInstallClosure(root, packages, "@changmen/db");
  expect(report.workspaces).toHaveLength(4);
  expect(report.edges.some(edge => edge.via.join(" -> ") === "@changmen/db -> @changmen/shared -> @changmen/db")).toBe(true);
});
for (const [name, edit] of [
  ["wrong local target", pkg => pkg.dependencies["@changmen/shared"] = "file:../../packages/client-core"],
  ["unknown local dependency", pkg => pkg.dependencies["@changmen/unreviewed"] = "file:../missing"],
]) it(`rejects ${name}`, () => {
  const packages = readInstallWorkspaces(root); edit(packages.get("@changmen/db").pkg);
  expect(declaredInstallClosure(root, packages, "@changmen/db").violations.length).toBeGreaterThan(0);
});
