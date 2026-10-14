import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { releasePlan, selectGtcRelease, verifyLegacyGtcBackendModules } from "./gtc-independent-release.mjs";
const source = file => fs.readFileSync(file, "utf8");
const captured = file => gitSource("832f3f76c30d6ad741ce850a68cd6ba1da7d06f9", file);
const matrix = () => [{ id: "frontend-only", passed: false, failedBoundaries: ["gtc:manually-rebound-settled-buy"] },
  { id: "backend-only", passed: true, failedBoundaries: [] }, { id: "paired", passed: true, failedBoundaries: [] }];
it("default plan keeps old-backend frontend-only deployment blocked", () => {
  expect(releasePlan([])).toBe("frontend-only");
  expect(selectGtcRelease(releasePlan([]), matrix())).toMatchObject({ passed: false, frontendOnlyGtcCompatible: false, blockedCombinations: ["frontend-only"] });
});
it("explicit backend-first verifies both intermediate and final combinations without relabeling frontend-only as compatible", () => {
  expect(selectGtcRelease(releasePlan(["--release-plan=backend-first"]), matrix())).toMatchObject({ passed: true, frontendOnlyGtcCompatible: false,
    requiredCombinations: ["backend-only", "paired"], deploymentOrder: ["backend", "frontend"] });
});
it.each(["backend-only", "paired"])("backend-first cannot hide a failed required combination %s", (id) => {
  const rows = matrix(); Object.assign(rows.find(row => row.id === id), { passed: false, failedBoundaries: ["missing exact lookup"] });
  expect(selectGtcRelease("backend-first", rows)).toMatchObject({ passed: false, failedBoundaries: ["missing exact lookup"] });
});
it.each([["--allow"], ["--release-plan=paired"], ["--release-plan=backend-first", "--release-plan=frontend-only"]])("rejects unrecognized/ambiguous options %o", args => {
  expect(() => releasePlan(args)).toThrow("release plan");
});
it.each([
  rows => rows.slice(1),
  rows => [rows[0], rows[0], rows[2]],
  rows => rows.map(row => row.id === "paired" ? { ...row, passed: undefined } : row),
  rows => rows.map(row => row.id === "frontend-only" ? { ...row, passed: true } : row),
  rows => rows.map(row => row.id === "paired" ? { ...row, failedBoundaries: ["hidden"] } : row),
])("rejects incomplete, duplicated or inconsistent matrix evidence %o", change => {
  expect(() => selectGtcRelease("backend-first", change(matrix()))).toThrow();
});
it("new backend keeps complete legacy GTC handler/imports/read/write behavior", () => expect(verifyLegacyGtcBackendModules(source, captured)).toBe(true));
const upgraded = file => gitSource("3d7562687f8bc81da7c138ddb1a93f48a7c8a7bf", file);
it("backend-first continuation accepts an already upgraded captured backend", () => expect(verifyLegacyGtcBackendModules(source, upgraded)).toBe(true));
it("reviewed recovery backend before the unsent command remains compatible", () => expect(verifyLegacyGtcBackendModules(source, file => gitSource("adb333bf24b6ba6aa3e441009b56f874a23f6ed9", file))).toBe(true));
it.each([
  ["handler.js", text => text.replace('"not_sent",', '"unexpected_send",')],
  ["recovery.js", text => text.replace('!gtcPmNeverSubmitted(row)', 'true')],
  ["handler.js", text => text.replace('return getGtcOrders(body, owner);', 'return [];')],
  ["handler.js", text => text.replace('if (action === "Pm_GtcMonitorOrders")', 'if (action === "Pm_GtcUnexpected")')],
  ["orders.js", text => text.replace('"GTC", await db.listPmGtc(owner)', '"FOK", await db.listPmGtc(owner)')],
  ["orders.js", text => text.replace('rows, owner, body.type', 'rows, "foreign", body.type')],
  ["orders.js", text => text + '\nvoid unexpectedTrade();'],
])("cannot exempt other GTC/backend behavior alongside new lookup: %s", (suffix, change) => {
  expect(() => verifyLegacyGtcBackendModules(file => file.endsWith(suffix) ? change(source(file)) : source(file), captured)).toThrow();
  expect(() => verifyLegacyGtcBackendModules(file => file.endsWith(suffix) ? change(source(file)) : source(file), upgraded)).toThrow();
  expect(() => verifyLegacyGtcBackendModules(source, file => file.endsWith(suffix) ? change(upgraded(file)) : upgraded(file))).toThrow();
});
