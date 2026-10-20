import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { restoreRayA8PrecheckSource, verifyRayA8PrecheckSources } from "./ray-a8-precheck-boundary.mjs";

const inventory = JSON.parse(fs.readFileSync(new URL("./ray-a8-precheck-increments.json", import.meta.url), "utf8"));
describe("exact RAY A8 precheck increment", () => {
  it.each(inventory.files)("restores original $file and rejects unrelated edits", row => {
    const current = fs.readFileSync(row.file, "utf8");
    const baseline = execFileSync("git", ["show", `${inventory.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    expect(restoreRayA8PrecheckSource(row.file, current)).toBe(baseline);
    expect(restoreRayA8PrecheckSource(row.file, baseline)).toBe(baseline);
    expect(restoreRayA8PrecheckSource(row.file, `${current}\nvoid 0;`)).toBe(`${current}\nvoid 0;`.replaceAll("\r\n", "\n"));
    expect(() => verifyRayA8PrecheckSources(file => file === row.file ? `${current}\nvoid 0;` : fs.readFileSync(file, "utf8")))
      .toThrow("only the exact RAY A8 precheck change");
  });
  it("does not exempt another venue or shared orchestration", () => {
    expect(restoreRayA8PrecheckSource("client/packages/venue-browser/adapter/ob/bet.ts", "changed")).toBe("changed");
    expect(restoreRayA8PrecheckSource("client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts", "changed")).toBe("changed");
  });
});
