// [changmen 扩展] Analyze metadata without executing installers or application modules.
import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { declaredInstallClosure, frontendInstallBoundary, inspectComponentInstallInputs, readInstallWorkspaces, venueBrowserDeclarationBoundary } from "./component-install-inputs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
it("reports real frontend/backend/RDS declarations without claiming installation isolation", () => {
  const report = inspectComponentInstallInputs(root);
  expect(report.violations).toEqual([]); expect(report.profiles.frontend.workspaces).toHaveLength(7);
  expect(report.profiles.backend.workspaces).toHaveLength(14); expect(report.profiles.rds.workspaces).toHaveLength(3);
  expect(report.profiles.backend.workspaces).not.toContain("@changmen/venue-adapter");
  expect(report.frontendBackendEdges).toEqual([]); expect(report.frontendDeclarationsIsolated).toBe(true);
  expect(report.profiles.frontend.build.directExternalPackages).toContain("vite");
  expect(report.profiles.frontend.directExternalPackages).not.toContain("vite");
  expect(report.installationCertified).toBe(false); expect(report.publishScopeOptimizationEnabled).toBe(false);
});
for (const [name, target] of [["@changmen/db", "server/db"], ["@changmen/storage", "server/storage"],
  ["@changmen/venue-node-loader", "packages/venue-adapter/loader"], ["@changmen/venue-node-registry", "packages/venue-adapter/registry"],
  ["@changmen/venue-adapter-tools", "packages/venue-adapter/scripts"]]) {
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
  expect(report.workspaces).toHaveLength(3);
  expect(report.edges.some(edge => edge.via.join(" -> ") === "@changmen/db -> @changmen/shared -> @changmen/db")).toBe(true);
});
for (const [name, edit] of [
  ["wrong local target", pkg => pkg.dependencies["@changmen/shared"] = "file:../../packages/client-core"],
  ["unknown local dependency", pkg => pkg.dependencies["@changmen/unreviewed"] = "file:../missing"],
]) it(`rejects ${name}`, () => {
  const packages = readInstallWorkspaces(root); edit(packages.get("@changmen/db").pkg);
  expect(declaredInstallClosure(root, packages, "@changmen/db").violations.length).toBeGreaterThan(0);
});
