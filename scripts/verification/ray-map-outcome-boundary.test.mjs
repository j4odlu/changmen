import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyProtectedSource, gitSource } from "./fok-exact-boundaries.mjs";
import { restoreRayMapOutcomeSource } from "./ray-frontend-boundary.mjs";
import { readAdapterBrowserSource } from "./adapter-browser-relocation.mjs";

const files = ["markets", "collect", "index"].map(name => `packages/venue-adapter/ray/${name}.ts`);
const read = withAdapterHistoryReader(file => readAdapterBrowserSource(file, readAdapterHistory(file, "utf8")));
describe("RAY map results are an exact display-only extension", () => {
  for (const file of files) {
    it(`${file}: still verifies the whole original module against the fixed VPS baseline`, () => {
      expect(() => verifyProtectedSource(file, read(file), gitSource("75b1efac66625e5f2bc9884a965b244bfaf337ed", file), read)).not.toThrow();
      expect(restoreRayMapOutcomeSource(file, read(file))).not.toContain("rayMapOutcome");
      expect(() => verifyProtectedSource(file, read(file) + "\nvoid unexpectedTradingAction();", gitSource("75b1efac66625e5f2bc9884a965b244bfaf337ed", file), read)).toThrow();
      expect(() => restoreRayMapOutcomeSource(file, read(file).replace("./rayMapOutcome", "./bet"))).toThrow("exact display-only RAY outcome hook");
    });
  }
  it("does not exempt an unregistered source", () => {
    expect(restoreRayMapOutcomeSource("packages/venue-adapter/ray/bet.ts", "void changed();")).toBe("void changed();");
  });
});
