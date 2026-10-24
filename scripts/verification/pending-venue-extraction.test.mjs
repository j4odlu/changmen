import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PENDING_VENUE_EXTRACTION as evidence, restorePendingVenueExtractionSource, restorePendingVenueVerificationSource, verifyPendingVenueExtraction } from "./pending-venue-extraction.mjs";
import { readPreviousWorkspaceFile, WORKSPACE_LAYOUT_RELOCATION } from "./workspace-layout-history.mjs";
import { PENDING_VENUE_FIXES, restorePendingVenueFixSource, verifyPendingVenueFixes } from "./pending-venue-fixes.mjs";
import { restoreFrontendDependencySource } from "./frontend-dependency-refactor.mjs";
const read = file => fs.readFileSync(file, "utf8");
const normalize = source => source.replaceAll("\r\n", "\n");
it("authenticates the complete extraction and composes exact inverses through the unchanged pending and FOK proofs", () => {
  expect(verifyPendingVenueExtraction(read)).toEqual({ files: 1, assets: 3 });
  const before = normalize(execFileSync("git", ["show", `${evidence.baseline}:${evidence.file}`], { encoding: "utf8", windowsHide: true }));
  expect(evidence.before).toBe(before);
  const previous = PENDING_VENUE_FIXES.files.find(row => row.file === evidence.file);
  const historical = normalize(execFileSync("git", ["show", `${PENDING_VENUE_FIXES.baseline}:${evidence.file}`], { encoding: "utf8", windowsHide: true }));
  for (const source of [read(evidence.file), normalize(read(evidence.file)).replaceAll("\n", "\r\n")]) {
    expect(restorePendingVenueExtractionSource(evidence.file, source)).toBe(before);
    expect(restorePendingVenueFixSource(evidence.file, source)).toBe(previous.before);
    expect(restoreFrontendDependencySource(evidence.file, source)).toBe(historical);
  }
});
it("rejects any extra gateway change and authenticates each extracted implementation using the supplied reader", () => {
  const changed = read(evidence.file) + "\nvoid unreviewed();";
  expect(restorePendingVenueExtractionSource(evidence.file, changed)).toBe(changed);
  expect(restorePendingVenueFixSource(evidence.file, changed)).toBe(changed);
  expect(() => verifyPendingVenueExtraction(file => file === evidence.file ? changed : read(file))).toThrow("Unreviewed pending lifecycle extraction");
  for (const asset of evidence.assets) {
    const tampered = file => read(file) + (file === asset.file ? "\nvoid unreviewed();" : "");
    expect(() => verifyPendingVenueExtraction(tampered)).toThrow("extracted pending implementation changed");
    expect(() => restorePendingVenueExtractionSource(evidence.file, read(evidence.file), tampered)).toThrow("extracted pending implementation changed");
    expect(() => verifyPendingVenueFixes(tampered)).toThrow("extracted pending implementation changed");
  }
});
it("certifies the stronger real-entry fault injection tests while retaining the old immutable migration source", () => {
  expect(evidence.verification).toHaveLength(1);
  for (const row of evidence.verification) {
    expect(row.before).toBe(normalize(execFileSync("git", ["show", `${evidence.baseline}:${row.file}`], { encoding: "utf8", windowsHide: true })));
    expect(restorePendingVenueVerificationSource(row.file, read(row.file))).toBe(row.before);
    const historical = WORKSPACE_LAYOUT_RELOCATION.files.find(file => file.canonical === row.file);
    expect(readPreviousWorkspaceFile(row.file, "utf8")).toBe(historical.before);
    const changed = read(row.file) + "\nvoid unreviewed();";
    expect(restorePendingVenueVerificationSource(row.file, changed)).toBe(changed);
    expect(() => verifyPendingVenueExtraction(file => file === row.file ? changed : read(file)))
      .toThrow("Unreviewed pending verification change");
  }
});
