import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { gameCatalogContract } from "./game-catalog-centralization-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const previousCommit = "84364793171244eca85378ef7bce3388f147b237";
const protectedFiles = ["packages/shared/catalog/game_catalog.ts", "packages/venue-adapter/ray/a8Collect.ts"];

describe("centralized game configuration retains full FOK source protection", () => {
  for (const file of protectedFiles) {
    const original = execFileSync("git", ["show", `${previousCommit}:${file}`], { encoding: "utf8" });
    it(`${file}: restores the precise migration to the complete original module`, () => {
      expect(verifyProtectedSource(file, read(file), original).exactBoundaryVerified).toBe(true);
    });
    it(`${file}: rejects extra executable statements`, () => {
      expect(() => verifyProtectedSource(file, `${read(file)}\nfetch('/unexpected');`, original)).toThrow();
    });
  }
  for (const file of [gameCatalogContract, "packages/shared/catalog/game_catalog_rules.ts", "packages/shared/catalog/game_catalog_rules.js", "packages/shared/catalog/game_catalog.json"]) {
    it(`${file}: rejects unreviewed changes to the migrated implementation or configuration`, () => {
      const target = protectedFiles[0];
      const original = execFileSync("git", ["show", `${previousCommit}:${target}`], { encoding: "utf8" });
      expect(() => verifyProtectedSource(target, read(target), original,
        requested => read(requested) + (requested === file ? "\n " : ""))).toThrow();
    });
  }
});
