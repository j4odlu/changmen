// [changmen 扩展] Keep the original full-file lock proof through one exact development-dependency replacement.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { PM_METADATA_BASELINE, restorePmBackendToolMetadata, restorePmNodeConsumerMetadata, restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";

const record = JSON.parse(fs.readFileSync(new URL("./pm-node-consumer-metadata.json", import.meta.url), "utf8"));
const file = "package-lock.json", current = restorePmBackendToolMetadata(file, fs.readFileSync(file, "utf8"));
const original = gitSource(PM_METADATA_BASELINE, file), previous = restorePmNodeConsumerMetadata(file, current);
it("changes only the resolver tooling declaration and restores both complete earlier and historical sources", () => {
  expect(record.file).toBe(file); expect(record.patches).toHaveLength(1);
  expect(createHash("sha256").update(previous).digest("hex")).toBe(record.baselineSha256);
  expect(previous).not.toBe(current);
  expect(restorePmSourceIsolationMetadata(file, current, original)).toBe(original);
  expect(restorePmSourceIsolationMetadata(file, previous, original)).toBe(original);
  const before = JSON.parse(previous), after = JSON.parse(current);
  expect(Object.keys(after.packages).filter(key => JSON.stringify(before.packages[key]) !== JSON.stringify(after.packages[key])))
    .toEqual(["server/match/resolver"]);
  expect(Object.keys(after.packages)).toEqual(Object.keys(before.packages));
  const dependency = after.packages["server/match/resolver"].devDependencies;
  expect(dependency).toEqual({ "@changmen/venue-node-loader": "file:../../../packages/venue-adapter/loader" });
  const restored = structuredClone(after); restored.packages["server/match/resolver"].devDependencies = before.packages["server/match/resolver"].devDependencies;
  expect(restored).toEqual(before);
});
for (const [name, mutate] of [
  ["redirected Node loader", source => source.replace('"file:../../../packages/venue-adapter/loader"', '"file:../../../packages/venue-adapter"')],
  ["extra text", source => source + "\n"],
  ["changed external SDK", source => { const lock = JSON.parse(source); lock.packages["node_modules/@polymarket/client"].version = "0.13.0"; return JSON.stringify(lock, null, 2) + "\n"; }],
]) it(`rejects ${name} without exempting any lock content`, () => {
  const source = mutate(current); expect(source).not.toBe(current);
  expect(() => restorePmSourceIsolationMetadata(file, source, original)).toThrow("exact registered");
});
