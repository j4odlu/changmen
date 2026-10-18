// [changmen 扩展] 完整历史源码恢复及依赖/导出篡改拒绝；不导入业务模块或执行网络请求。
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { PM_METADATA_BASELINE, restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";

const record = JSON.parse(fs.readFileSync(new URL("./pm-source-isolation-metadata.json", import.meta.url), "utf8"));
const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const old = file => gitSource(PM_METADATA_BASELINE, file);
const restore = (file, source = read(file)) => restorePmSourceIsolationMetadata(file, source, old(file));
const lockFile = "package-lock.json";
const oldLock = JSON.parse(old(lockFile)), lock = JSON.parse(read(lockFile));
const changedLockPaths = ["", "client/web", "node_modules/@changmen/pm-market-data-browser",
  "client/web/node_modules/socketcluster-client",
  "node_modules/@changmen/venue-node-loader", "node_modules/@changmen/venue-node-registry",
  "node_modules/@changmen/venue-adapter-tools", "packages/venue-adapter/scripts",
  "client/packages/pm-market-data-browser", "packages/venue-adapter", "packages/venue-adapter/loader",
  "packages/venue-adapter/registry", "server/backend", "server/db", "server/match/resolver", "server/storage"].sort();

it("keeps the fixed historical commit and exactly three migration targets", () => {
  expect(PM_METADATA_BASELINE).toBe("a233e20534395b31401828e754432407b109053d");
  expect(record.baseline).toBe(PM_METADATA_BASELINE);
  expect(record.changes.map(row => row.file)).toEqual(["server/db/package.json", "packages/shared/package.json", lockFile]);
  expect(record.changes.flatMap(row => row.patches)).toHaveLength(17);
});

describe.each(record.changes)("$file exact source migration", ({ file, patches }) => {
  it("restores the entire original file and still accepts its unchanged historical form", () => {
    expect(restore(file)).toBe(old(file));
    expect(restore(file, old(file))).toBe(old(file));
    expect(restore(file, read(file).replaceAll("\n", "\r\n"))).toBe(old(file));
  });
  it("rejects a forged historical original even when the candidate matches it", () => {
    const forged = old(file) + "\n";
    expect(() => restorePmSourceIsolationMetadata(file, forged, forged)).toThrow("immutable original");
  });
  it("retains full-text protection against an extra property, duplicate JSON key or formatting change", () => {
    for (const source of [read(file) + "\n", read(file).replace("{", '{\n  "unreviewed": true,'),
      read(file).replace("{", '{\n  "name": "duplicate",')]) expect(() => restore(file, source)).toThrow("exact registered");
  });
  for (const [index, patch] of patches.entries()) {
    it(`rejects a changed/partial migration hunk ${index + 1}; a complete original remains valid`, () => {
      const start = patch.newCount === 0 ? patch.newStart : patch.newStart - 1;
      const partial = read(file).split("\n");
      partial.splice(start, patch.newCount, ...patch.before);
      const partiallyRestored = partial.join("\n");
      if (partiallyRestored === old(file)) expect(restore(file, partiallyRestored)).toBe(old(file));
      else expect(() => restore(file, partiallyRestored)).toThrow("exact registered");
      if (patch.newCount > 1) {
        const missing = read(file).split("\n"); missing.splice(start, 1);
        expect(() => restore(file, missing.join("\n"))).toThrow("exact registered");
      }
      const changed = read(file).split("\n");
      if (patch.newCount) changed[start] += " ";
      else changed.splice(start, 0, '        "unregistered": true,');
      expect(() => restore(file, changed.join("\n"))).toThrow("exact registered");
    });
  }
});

for (const file of ["server/db/package.json", "packages/shared/package.json"]) {
  it(`${file}: preserves every old export, dependency, script and other existing top-level property`, () => {
    const original = JSON.parse(old(file)), current = JSON.parse(read(file));
    for (const [key, value] of Object.entries(original)) {
      if (["exports", "dependencies"].includes(key)) {
        for (const [name, target] of Object.entries(value)) expect(current[key][name]).toEqual(target);
      } else expect(current[key]).toEqual(value);
    }
  });
}

it("changes exactly 15 workspace/link records and removes only the unused nested socket client", () => {
  expect(Object.keys(lock).filter(key => key !== "packages").map(key => [key, lock[key]]))
    .toEqual(Object.keys(oldLock).filter(key => key !== "packages").map(key => [key, oldLock[key]]));
  const changed = [...new Set([...Object.keys(oldLock.packages), ...Object.keys(lock.packages)])]
    .filter(key => JSON.stringify(oldLock.packages[key]) !== JSON.stringify(lock.packages[key])).sort();
  expect(changed).toEqual(changedLockPaths);
  expect(oldLock.packages["client/web/node_modules/socketcluster-client"].version).toBe("19.2.7");
  expect(lock.packages["client/web/node_modules/socketcluster-client"]).toBeUndefined();
  for (const [key, value] of Object.entries(oldLock.packages)) {
    if (key.includes("node_modules/") && !value.link && key !== "client/web/node_modules/socketcluster-client")
      expect(lock.packages[key], key).toEqual(value);
  }
  for (const key of changed) if (key.startsWith("node_modules/")) expect(lock.packages[key]).toEqual({
    resolved: { "node_modules/@changmen/pm-market-data-browser": "client/packages/pm-market-data-browser",
      "node_modules/@changmen/venue-node-loader": "packages/venue-adapter/loader",
      "node_modules/@changmen/venue-node-registry": "packages/venue-adapter/registry",
      "node_modules/@changmen/venue-adapter-tools": "packages/venue-adapter/scripts" }[key], link: true,
  });
});

it("matches the workspace dependency declarations to the exact lock records", () => {
  for (const file of changedLockPaths.filter(file => !file.includes("node_modules/"))) {
    const manifest = JSON.parse(read(file ? `${file}/package.json` : "package.json")), entry = lock.packages[file];
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "workspaces"])
      expect(entry[key], `${file}:${key}`).toEqual(manifest[key]);
  }
});

for (const [name, mutate] of [
  ["SDK version", x => { x.packages["node_modules/@polymarket/client"].version = "0.13.0"; }],
  ["SDK integrity", x => { x.packages["node_modules/@polymarket/client"].integrity = "sha512-forged"; }],
  ["SDK download source", x => { x.packages["node_modules/@polymarket/client"].resolved = "https://example.invalid/sdk.tgz"; }],
  ["transitive dependency", x => { x.packages["node_modules/@polymarket/client"].dependencies.unreviewed = "1.0.0"; }],
  ["Vue host/peer contract", x => { x.packages["packages/venue-adapter"].peerDependencies.vue = "^4.0.0"; }],
  ["Node workspace target", x => { x.packages["node_modules/@changmen/venue-node-loader"].resolved = "packages/pm-market-data-browser"; }],
  ["backend runtime dependency", x => { x.packages["server/backend"].dependencies["@changmen/venue-node-loader"] = "file:../../packages/pm-market-data-browser"; }],
  ["new external package", x => { x.packages["node_modules/unreviewed"] = { version: "1.0.0" }; }],
  ["omitted package", x => { delete x.packages["node_modules/@polymarket/client"]; }],
]) it(`rejects lock tampering with ${name}`, () => {
  const changed = structuredClone(lock); mutate(changed);
  expect(() => restore(lockFile, JSON.stringify(changed, null, 2) + "\n")).toThrow("exact registered");
});

for (const [file, from, to] of [
  ["server/db/package.json", '"./index.js"', '"./runtime_schema.js"'],
  ["server/db/package.json", '"^8.21.0"', '"^9.0.0"'],
  ["server/db/package.json", '"file:../../packages/shared"', '"file:../backend"'],
  ["packages/shared/package.json", '"./currency.ts"', '"./match-identity/index.js"'],
  ["packages/shared/package.json", '"./match-identity/index.js"', '"../../server/db/index.js"'],
]) it(`rejects an export/dependency redirection in ${file}: ${from}`, () => {
  expect(read(file)).toContain(from);
  expect(() => restore(file, read(file).replace(from, to))).toThrow("exact registered");
});

it("does not normalize or remove an edit in any unregistered business source", () => {
  const file = "server/collectors/polymarket-sports/sport_state.js", source = old(file) + "\nthrow Error('tampered');\n";
  expect(restorePmSourceIsolationMetadata(file, source, old(file))).toBe(source);
  expect(restorePmSourceIsolationMetadata(file, source, old(file))).not.toBe(old(file));
});
