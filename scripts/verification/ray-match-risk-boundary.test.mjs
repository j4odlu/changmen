import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreRayMatchRiskSource } from "./ray-match-risk-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const manifest = JSON.parse(read("scripts/verification/vps-fok-baseline.json"));
const files = ["packages/venue-adapter/ray/index.ts", "client/web/src/stores/betting/autoBet/executeArbBet.ts",
  "client/web/src/stores/betting/execution/manual.ts", "client/web/src/orderModes/fok/manual.ts",
  "client/web/src/stores/betting/placeValueBet.ts", "client/web/src/stores/betting/a8/runA8ArbRound.ts",
  "client/web/src/extensions/valueBet/valueBetAutoBet.ts"];
describe("exact RAY abnormal-match extension with unchanged normal trading", () => {
  for (const file of files) {
    it(`${file}: preserves the full pre-feature source and the immutable VPS baseline`, () => {
      const source = read(file);
      const restored = restoreRayMatchRiskSource(file, source);
      expect(restored).toBe(gitSource("f32254dac0b7ffea0b260419b6097e584c55ee33", file).replaceAll("\r\n", "\n"));
      expect(restoreRayMatchRiskSource(file, restored)).toBe(restored);
      expect(() => restoreRayMatchRiskSource(file, source.replace("isRayMatchRiskClosed", "unexpectedGate"))).toThrow();
      const added = restoreRayMatchRiskSource(file, source + "\nvoid unexpectedTradingAction();");
      expect(added).not.toBe(restored);
      if (manifest.protectedFiles[file]) {
        const baseline = gitSource(manifest.version, file);
        expect(() => verifyProtectedSource(file, source, baseline, read)).not.toThrow();
        expect(() => verifyProtectedSource(file, source + "\nvoid unexpectedTradingAction();", baseline, read)).toThrow();
      }
    });
  }
  it("does not normalize unregistered files", () => {
    expect(restoreRayMatchRiskSource("other.ts", "changed();")).toBe("changed();");
  });
});
