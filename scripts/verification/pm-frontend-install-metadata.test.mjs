import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 第二阶段精确逆变换继承第一阶段全文证明，拒绝 Node 安装依赖回流。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { PM_METADATA_BASELINE, restorePmFrontendBuildMetadata, restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";
const file = "package-lock.json", current = restorePmFrontendBuildMetadata(file, readAdapterHistory(file, "utf8"));
const first = JSON.parse(readAdapterHistory(new URL("./pm-source-isolation-metadata.json", import.meta.url), "utf8"));
const change = JSON.parse(readAdapterHistory(new URL("./pm-frontend-install-metadata.json", import.meta.url), "utf8"));
const original = gitSource(PM_METADATA_BASELINE, file);
it("restores the whole previous registered lock and then the immutable historical baseline", () => {
  expect(change.patches).toHaveLength(8);
  expect(change.baselineSha256).toBe(first.changes.find(row => row.file === file).migratedSha256);
  const lines = current.split("\n");
  for (const patch of [...change.patches].reverse()) {
    const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
    expect(lines.slice(start, start + patch.newCount)).toEqual(patch.after);
    lines.splice(start, patch.newCount, ...patch.before);
  }
  const previous = lines.join("\n");
  expect(createHash("sha256").update(previous).digest("hex")).toBe(change.baselineSha256);
  expect(restorePmSourceIsolationMetadata(file, previous, original)).toBe(original);
  expect(restorePmSourceIsolationMetadata(file, current, original)).toBe(original);
});
it("keeps the Vite alias SDK at the exact original root version and declares the build env parser", () => {
  const lock = JSON.parse(current), old = JSON.parse(original), manifest = JSON.parse(readAdapterHistory("client/web/package.json", "utf8"));
  expect(manifest.dependencies["socketcluster-client"]).toBe("20.0.1");
  expect(lock.packages["node_modules/socketcluster-client"]).toEqual(old.packages["node_modules/socketcluster-client"]);
  expect(lock.packages["node_modules/socketcluster-client"].version).toBe("20.0.1");
  expect(manifest.devDependencies.dotenv).toBe(lock.packages["node_modules/dotenv"].version);
});
for (const [index, patch] of change.patches.entries()) it(`rejects a missing/partial second-stage migration ${index + 1}`, () => {
  const lines = current.split("\n"), start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
  lines.splice(start, patch.newCount, ...patch.before);
  expect(() => restorePmSourceIsolationMetadata(file, lines.join("\n"), original)).toThrow("exact registered");
});
for (const [name, mutate] of [
  ["DB installed by browser adapter", lock => { lock.packages["packages/venue-adapter"].dependencies["@changmen/db"] = "file:../../server/db"; }],
  ["storage installed by browser adapter", lock => { lock.packages["packages/venue-adapter"].dependencies["@changmen/storage"] = "file:../../server/storage"; }],
  ["tool redirected to DB", lock => { lock.packages["packages/venue-adapter/scripts"].dependencies["@changmen/storage"] = "file:../../../server/db"; }],
]) it(`rejects ${name}`, () => {
  const lock = JSON.parse(current); mutate(lock);
  expect(() => restorePmSourceIsolationMetadata(file, JSON.stringify(lock, null, 2) + "\n", original)).toThrow("exact registered");
});
