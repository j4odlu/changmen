// [changmen 扩展] One exact tooling declaration change; every prior lock proof remains in force.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { PM_METADATA_BASELINE, restorePmClientFolderMetadata, restorePmBackendToolMetadata, restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";

const file = "package-lock.json", current = restorePmClientFolderMetadata(file, fs.readFileSync(file, "utf8"));
const record = JSON.parse(fs.readFileSync(new URL("./pm-backend-tool-metadata.json", import.meta.url), "utf8"));
const original = gitSource(PM_METADATA_BASELINE, file), previous = restorePmBackendToolMetadata(file, current);
it("changes only the backend tooling owner and restores the complete previous and historical lock", () => {
  expect(record.file).toBe(file); expect(record.patches).toHaveLength(2);
  expect(previous).not.toBe(current);
  expect(createHash("sha256").update(previous).digest("hex")).toBe(record.baselineSha256);
  expect(restorePmSourceIsolationMetadata(file, current, original)).toBe(original);
  expect(restorePmSourceIsolationMetadata(file, previous, original)).toBe(original);
  const before = JSON.parse(previous), after = JSON.parse(current);
  expect(Object.keys(after.packages)).toEqual(Object.keys(before.packages));
  expect(Object.keys(after.packages).filter(key => JSON.stringify(before.packages[key]) !== JSON.stringify(after.packages[key])))
    .toEqual(["packages/venue-adapter/registry", "server/backend"]);
  const dependencies = after.packages["server/backend"].devDependencies;
  expect(dependencies["@changmen/venue-adapter"]).toBeUndefined();
  expect(dependencies["@changmen/venue-adapter-tools"]).toBe("file:../../packages/venue-adapter/scripts");
  const restored = structuredClone(after);
  delete restored.packages["server/backend"].devDependencies["@changmen/venue-adapter-tools"];
  restored.packages["server/backend"].devDependencies["@changmen/venue-adapter"] = "file:../../packages/venue-adapter";
  expect(after.packages["packages/venue-adapter/registry"].devDependencies).toBeUndefined();
  restored.packages["packages/venue-adapter/registry"].devDependencies = before.packages["packages/venue-adapter/registry"].devDependencies;
  expect(restored).toEqual(before);
});
for (const [name, mutate] of [
  ["tool redirected to mixed adapter", lock => { lock.packages["server/backend"].devDependencies["@changmen/venue-adapter-tools"] = "file:../../packages/venue-adapter"; }],
  ["tool dependency redirected to browser module", lock => { lock.packages["packages/venue-adapter/scripts"].dependencies["@changmen/storage"] = "file:../../pm-market-data-browser"; }],
  ["SDK integrity drift", lock => { lock.packages["node_modules/@polymarket/client"].integrity = "sha512-forged"; }],
]) it(`rejects ${name} without excluding any lock record`, () => {
  const lock = JSON.parse(current); mutate(lock);
  expect(() => restorePmSourceIsolationMetadata(file, JSON.stringify(lock, null, 2) + "\n", original)).toThrow("exact registered");
});
it("rejects any extra text while keeping unchanged historic sources valid", () => {
  expect(() => restorePmSourceIsolationMetadata(file, current + "\n", original)).toThrow("exact registered");
  expect(restorePmSourceIsolationMetadata(file, original, original)).toBe(original);
});
