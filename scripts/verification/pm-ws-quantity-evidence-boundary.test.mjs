import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { restorePmWsQuantityEvidenceSource } from "./pm-ws-quantity-evidence-boundary.mjs";
const file = "packages/venue-adapter/polymarket/diagnostics/orderTrace.ts";
const helper = "packages/venue-adapter/polymarket/diagnostics/wsQuantityEvidence.ts";
const readBeforeExecution = path => fs.readFileSync(path, "utf8");
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
it("restores the original diagnostic implementation without altering confirmation", () => {
  expect(restorePmWsQuantityEvidenceSource(file, read(file), read, true)).not.toContain("wsSizeMatched");
});
it("rejects altered logging flow", () => {
  expect(() => restorePmWsQuantityEvidenceSource(file, read(file).replace('void saveUserLog(', 'await saveUserLog('), read, true)).toThrow();
});
it("rejects leaking arbitrary input through the evidence helper", () => {
  expect(() => restorePmWsQuantityEvidenceSource(file, read(file), path => path === helper
    ? read(path).replace('redacted: true', 'raw: value') : read(path), true)).toThrow();
});
