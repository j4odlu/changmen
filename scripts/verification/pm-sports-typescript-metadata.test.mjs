import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreClientPackageMetadata } from "./client-package-relocation.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { restorePmSportsTypeScriptMetadata as restore } from "./pm-sports-typescript-metadata.mjs";
import { restorePmSourceIsolationMetadata, PM_METADATA_BASELINE } from "./pm-source-isolation-metadata.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";
const read = withAdapterHistoryReader(file => restoreClientPackageMetadata(file, readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n")));
const file = "package-lock.json", current = read(file), before = restore(file, current);
const keys = ["server/collectors/polymarket-sports", "server/db", "server/storage"];
it("changes only the three workspace type dependency records and preserves every SDK record", () => {
  expect(before).not.toBe(current);
  const old = JSON.parse(before), next = JSON.parse(current);
  expect(Object.keys(next.packages)).toEqual(Object.keys(old.packages));
  expect(Object.keys(next.packages).filter(key => JSON.stringify(next.packages[key]) !== JSON.stringify(old.packages[key]))).toEqual(keys);
  for (const key of keys) {
    const manifest = JSON.parse(read(`${key}/package.json`));
    expect(next.packages[key].dependencies).toEqual(manifest.dependencies);
    expect(next.packages[key].devDependencies).toEqual(manifest.devDependencies);
    const restored = JSON.parse(restore(`${key}/package.json`, read(`${key}/package.json`)));
    expect(restored.dependencies).toEqual(old.packages[key].dependencies);
    expect(restored.devDependencies).toEqual(old.packages[key].devDependencies);
  }
  expect(restore(file, current.replaceAll("\n", "\r\n"))).toBe(before);
  expect(restore(file, before)).toBe(before);
  expect(restorePmSourceIsolationMetadata(file, current, gitSource(PM_METADATA_BASELINE, file))).toBe(gitSource(PM_METADATA_BASELINE, file));
});
for (const [label, mutate] of [
  ["extra whitespace", source => source + "\n"],
  ["SDK integrity", source => { const data = JSON.parse(source); data.packages["node_modules/@polymarket/client"].integrity = "forged"; return JSON.stringify(data, null, 2) + "\n"; }],
  ["compiler drift", source => source.replace('"typescript": "6.0.3"', '"typescript": "6.0.4"')],
  ["dependency redirect", source => source.replace('"@changmen/api-contract": "file:../../packages/api-contract"', '"@changmen/api-contract": "file:../../db"')],
]) it(`rejects unregistered ${label}`, () => {
  const changed = mutate(current);
  expect(changed).not.toBe(current);
  expect(restore(file, changed)).toBe(changed);
  expect(() => restorePmSourceIsolationMetadata(file, changed, gitSource(PM_METADATA_BASELINE, file))).toThrow();
});
it("does not accept unrelated manifest edits or application source", () => {
  for (const key of keys) {
    const path = `${key}/package.json`, source = read(path);
    expect(restore(path, source + "\n")).toBe(source + "\n");
  }
  expect(restore("server/db/index.js", current)).toBe(current);
});
