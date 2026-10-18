// [changmen 扩展] Exact development/type dependency increment, with complete
// original lock verification and negative cases for unrelated edits.
import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restorePmCollectorTypeScriptMetadata as restore } from "./pm-collector-typescript-metadata.mjs";
import { restorePmSportsTypeScriptMetadata } from "./pm-sports-typescript-metadata.mjs";
import { restorePmSourceIsolationMetadata, PM_METADATA_BASELINE } from "./pm-source-isolation-metadata.mjs";

const file = "package-lock.json";
const source = restorePmSportsTypeScriptMetadata(file, fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
const previous = gitSource("84364793171244eca85378ef7bce3388f147b237", file);
const key = "server/collectors/polymarket-esports";
const sportsKey = "server/collectors/polymarket-sports";

it("changes exactly the two collector records and restores the complete pre-migration lock", () => {
  expect(restore(file, source)).toBe(previous);
  expect(restore(file, source.replaceAll("\n", "\r\n"))).toBe(previous);
  expect(restore(file, previous)).toBe(previous);
  const before = JSON.parse(previous), after = JSON.parse(source);
  expect(Object.keys(after.packages)).toEqual(Object.keys(before.packages));
  expect(Object.keys(after.packages).filter(path => JSON.stringify(after.packages[path]) !== JSON.stringify(before.packages[path])))
    .toEqual([key, sportsKey]);
  const manifest = JSON.parse(fs.readFileSync(`${key}/package.json`, "utf8"));
  expect(after.packages[key].dependencies).toEqual(manifest.dependencies);
  expect(after.packages[key].devDependencies).toEqual(manifest.devDependencies);
  const sportsManifest = JSON.parse(restorePmSportsTypeScriptMetadata(`${sportsKey}/package.json`, fs.readFileSync(`${sportsKey}/package.json`, "utf8")));
  expect(after.packages[sportsKey].dependencies).toEqual(sportsManifest.dependencies);
  const reverted = structuredClone(after);
  delete reverted.packages[key].dependencies["@changmen/api-contract"];
  delete reverted.packages[key].devDependencies;
  delete reverted.packages[sportsKey].dependencies["@changmen/shared"];
  expect(reverted).toEqual(before);
  // Every earlier full-text proof still reaches the same immutable original.
  expect(restorePmSourceIsolationMetadata(file, source, gitSource(PM_METADATA_BASELINE, file)))
    .toBe(gitSource(PM_METADATA_BASELINE, file));
});

for (const [label, mutate] of [
  ["extra whitespace", value => value + "\n"],
  ["collector dependency redirect", value => value.replace('"@changmen/api-contract": "file:../../../packages/api-contract"', '"@changmen/api-contract": "file:../../db"')],
  ["compiler version drift", value => value.replace('"typescript": "6.0.3"', '"typescript": "6.0.4"')],
  ["sports collector dependency redirect", value => { const lock = JSON.parse(value); lock.packages[sportsKey].dependencies["@changmen/shared"] = "file:../../db"; return JSON.stringify(lock, null, 2) + "\n"; }],
  ["SDK integrity drift", value => { const lock = JSON.parse(value); lock.packages["node_modules/@polymarket/client"].integrity = "sha512-forged"; return JSON.stringify(lock, null, 2) + "\n"; }],
  ["unrelated workspace edit", value => { const lock = JSON.parse(value); lock.packages["server/db"].version = "2.0.0"; return JSON.stringify(lock, null, 2) + "\n"; }],
]) it(`rejects ${label} through the complete historical comparison`, () => {
  const changed = mutate(source);
  expect(changed).not.toBe(source);
  expect(restore(file, changed)).not.toBe(previous);
  expect(() => restorePmSourceIsolationMetadata(file, changed, gitSource(PM_METADATA_BASELINE, file)))
    .toThrow("exact registered");
});

it("does not normalize any other source or replace any historical proof", () => {
  expect(restore("server/db/index.js", source)).toBe(source);
  for (const proof of ["vps-fok-baseline.json", "dependency-security-metadata.json", "pm-source-isolation-metadata.json", "runtime-tooling-migration.json"])
    expect(fs.readFileSync(`scripts/verification/${proof}`, "utf8").replaceAll("\r\n", "\n"))
      .toBe(gitSource("84364793171244eca85378ef7bce3388f147b237", `scripts/verification/${proof}`));
});

it("restores only the exact shared dependency increment in the complete sports collector manifest", () => {
  const manifestFile = `${sportsKey}/package.json`;
  const current = restorePmSportsTypeScriptMetadata(manifestFile, fs.readFileSync(manifestFile, "utf8").replaceAll("\r\n", "\n"));
  const historical = gitSource(PM_METADATA_BASELINE, manifestFile);
  expect(restore(manifestFile, current)).toBe(historical);
  expect(restorePmSourceIsolationMetadata(manifestFile, current, historical)).toBe(historical);
  for (const changed of [current + "\n", current.replace('"^8.21.0"', '"^8.22.0"'),
    current.replace('"file:../../../packages/shared"', '"file:../../db"')]) {
    expect(changed).not.toBe(current);
    expect(restorePmSourceIsolationMetadata(manifestFile, changed, historical)).not.toBe(historical);
  }
});
