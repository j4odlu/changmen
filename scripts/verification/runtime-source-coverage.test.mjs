import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restoreRuntimeCoverageSource } from "./runtime-source-coverage.mjs";

const file = "packages/shared/tooling/runtime_version.js";
const current = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
it("restores the complete original identity source without replacing its historical reference", () => {
  expect(restoreRuntimeCoverageSource(current)).toBe(gitSource("abdfce46d46f562c208ea0d832b6cafc02fd2360", "server/storage/runtime_version.js"));
  expect(restoreRuntimeCoverageSource(current.replaceAll("\n", "\r\n"))).toBe(restoreRuntimeCoverageSource(current));
});
for (const [label, mutate] of [
  ["missing archive discovery", source => source.replace('"client/packages", ', "")],
  ["missing migrated coverage", source => source.replace('  if (file.startsWith("client/packages/")) return true;\n', "")],
  ["broader client coverage", source => source.replace('file.startsWith("client/packages/")', 'file.startsWith("client/")')],
  ["weakened original exclusion", source => source.replace("node_modules|dist|", "dist|")],
  ["narrowed original package coverage", source => source.replace("|packages\\/", "")],
  ["extra source", source => `${source}\nvoid 0;\n`],
]) it(`rejects ${label}`, () => {
  const changed = mutate(current); expect(changed).not.toBe(current);
  expect(() => restoreRuntimeCoverageSource(changed)).toThrow("exact registered runtime coverage");
});
