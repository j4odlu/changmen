import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PENDING_VENUE_FIXES as evidence, restorePendingVenueFixSource, verifyPendingVenueFixes } from "./pending-venue-fixes.mjs";
import { restoreFrontendDependencySource } from "./frontend-dependency-refactor.mjs";
const read = file => fs.readFileSync(file, "utf8");
const normalize = source => source.replaceAll("\r\n", "\n");
it("certifies exact bug fixes and restores every complete pre-refactor source without replacing old inventories", () => {
  expect(verifyPendingVenueFixes(read)).toEqual({ files: 6, assets: 2 });
  for (const row of evidence.files) {
    const original = normalize(execFileSync("git", ["show", `${evidence.baseline}:${row.file}`], { encoding: "utf8", windowsHide: true }));
    for (const source of [read(row.file), normalize(read(row.file)).replaceAll("\n", "\r\n")]) {
      const restored = restorePendingVenueFixSource(row.file, source);
      expect(restored).toBe(row.before);
      expect(restoreFrontendDependencySource(row.file, restored)).toBe(original);
    }
  }
});
it("does not conceal extra changes to the gateway, order API, session cleanup or extracted helpers", () => {
  for (const row of evidence.files) {
    const changed = read(row.file) + "\nvoid unreviewed();";
    expect(restorePendingVenueFixSource(row.file, changed)).toBe(changed);
    expect(() => verifyPendingVenueFixes(file => file === row.file ? changed : read(file))).toThrow("unreviewed pending venue fix");
  }
  for (const row of evidence.assets)
    expect(() => verifyPendingVenueFixes(file => read(file) + (file === row.file ? "\nvoid unreviewed();" : "")))
      .toThrow("pending venue fix implementation changed");
});
