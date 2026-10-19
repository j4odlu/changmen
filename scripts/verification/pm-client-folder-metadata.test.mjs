import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Verify physical moves and complete metadata restoration without changing any historical proof.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restorePmClientFolderMetadata, restorePmSourceIsolationMetadata, PM_METADATA_BASELINE } from "./pm-source-isolation-metadata.mjs";
import { pmNodeBrowserLoaderTarget } from "./pm-dependency-audit.mjs";
import { classifyDeployScope } from "../deploy/classify-deploy-scope.mjs";
import { restoreRuntimeToolingMetadata } from "./runtime-tooling-migration.mjs";
import { restoreVenueBrowserConsumers } from "./venue-browser-consumers.mjs";

const record = JSON.parse(readAdapterHistory(new URL("./pm-client-folder-metadata.json", import.meta.url), "utf8"));
const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n"));
const sha = source => createHash("sha256").update(source).digest("hex");
it("moves exactly two unfrozen frontend directories without leaving duplicate implementations", () => {
  expect(record.moves).toHaveLength(19);
  expect(fs.existsSync("packages/pm-market-data-browser")).toBe(false);
  expect(fs.existsSync("devtools/venue-adapter/frontend")).toBe(false);
  const protectedFiles = JSON.parse(read("scripts/verification/vps-fok-baseline.json")).protectedFiles;
  for (const row of record.moves) {
    expect(protectedFiles[row.from]).toBeUndefined();
    expect(sha(restoreVenueBrowserConsumers(row.to,read(row.to)))).toBe(row.migratedSha256);
    if (/\/src\/.*\.ts$/.test(row.to) || /(?:list-web-venue-imports|relativize-internal-imports|sync-package-exports)\.mjs$/.test(row.to))
      expect(row.migratedSha256).toBe(row.sha256);
  }
});
it("resolves the unchanged package name to the actual client directory", () => {
  const target = createRequire(import.meta.url).resolve("@changmen/pm-market-data-browser");
  expect(fs.realpathSync(target)).toBe(fs.realpathSync("client/packages/pm-market-data-browser/src/index.ts"));
});
for (const change of record.changes) {
  it(`${change.file}: restores the entire prior metadata file and rejects normalization of extra content`, () => {
    const current = restoreRuntimeToolingMetadata(change.file, read(change.file)), previous = restorePmClientFolderMetadata(change.file, current);
    expect(sha(current)).toBe(change.migratedSha256);
    expect(sha(previous)).toBe(change.baselineSha256);
    expect(restorePmClientFolderMetadata(change.file, previous)).toBe(previous);
    expect(restorePmClientFolderMetadata(change.file, current + "\n")).not.toBe(previous);
  });
}
it("retains all original full-text historical lock proofs and exactly six workspace record changes", () => {
  expect(PM_METADATA_BASELINE).toBe("a233e20534395b31401828e754432407b109053d");
  const current = restoreRuntimeToolingMetadata("package-lock.json", read("package-lock.json")), previous = restorePmClientFolderMetadata("package-lock.json", current);
  expect(restorePmSourceIsolationMetadata("package-lock.json", current, gitSource(PM_METADATA_BASELINE, "package-lock.json")))
    .toBe(gitSource(PM_METADATA_BASELINE, "package-lock.json"));
  const old = JSON.parse(previous).packages, next = JSON.parse(current).packages;
  expect([...new Set([...Object.keys(old), ...Object.keys(next)])].filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key])).sort())
    .toEqual(["", "client/packages/pm-market-data-browser", "client/web", "node_modules/@changmen/pm-market-data-browser",
      "packages/pm-market-data-browser", "packages/venue-adapter"].sort());
  for (const [key, value] of Object.entries(old)) if (key.includes("node_modules/") && !value.link) expect(next[key]).toEqual(value);
});
for (const [label, mutate] of [
  ["SDK integrity", lock => { lock.packages["node_modules/@polymarket/client"].integrity = "sha512-unreviewed"; }],
  ["workspace link", lock => { lock.packages["node_modules/@changmen/pm-market-data-browser"].resolved = "server/db"; }],
  ["browser dependency", lock => { lock.packages["client/web"].dependencies["@changmen/pm-market-data-browser"] = "file:../../server/db"; }],
]) it(`rejects ${label} drift through the unchanged complete historical comparison`, () => {
  const lock = JSON.parse(read("package-lock.json")); mutate(lock);
  expect(() => restorePmSourceIsolationMetadata("package-lock.json", JSON.stringify(lock, null, 2) + "\n",
    gitSource(PM_METADATA_BASELINE, "package-lock.json"))).toThrow("exact registered");
});
it("keeps both new physical and public package paths forbidden to Node custom loaders", () => {
  for (const [loaderSymbol, args] of [
    ["adapterRequire", ["..", "..", "client", "packages", "pm-market-data-browser", "src/index.ts"]],
    ["backendRequire", ["@changmen/pm-market-data-browser/service"]],
  ]) expect(pmNodeBrowserLoaderTarget({ environment: "node", kind: "custom-loader", loaderSymbol, arguments: args })).toBeTruthy();
});
it("does not narrow publication because browser files moved into client", () => {
  expect(classifyDeployScope(["packages/pm-market-data-browser/src/index.ts"])).toBe("full");
  expect(classifyDeployScope(["client/packages/pm-market-data-browser/src/index.ts"])).toBe("full");
  expect(classifyDeployScope(["package.json", "package-lock.json", "client/packages/pm-market-data-browser/src/index.ts"])).toBe("full");
});
it("retains every old compatibility contract except the three exact tool locations", () => {
  const current = JSON.parse(restoreRuntimeToolingMetadata("scripts/verification/source-ownership-inputs.json", read("scripts/verification/source-ownership-inputs.json")));
  const previous = JSON.parse(restorePmClientFolderMetadata("scripts/verification/source-ownership-inputs.json", read("scripts/verification/source-ownership-inputs.json")));
  expect(current.compatibilityEntries).toEqual(previous.compatibilityEntries);
  expect(current.compatibilityAssets).toEqual(previous.compatibilityAssets);
  const oldCli = previous.compatibilityCliEntries, cli = current.compatibilityCliEntries;
  expect(cli.map(row => row.file)).toEqual(oldCli.map(row => row.file));
  expect(cli.filter((row, index) => JSON.stringify(row) !== JSON.stringify(oldCli[index]))).toHaveLength(3);
  for (const row of cli) expect(path.isAbsolute(row.canonical)).toBe(false);
});
