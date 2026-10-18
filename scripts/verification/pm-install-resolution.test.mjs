// [changmen 扩展] Reject lost or drifting resolution evidence; installation runs remain explicit.
import { expect, it } from "vitest";
import { comparePmInstallResolutions } from "./pm-install-resolution.mjs";
const row = { importer: "server/backend/sdk.js", spec: "sdk", mode: "node-esm", target: "node_modules/sdk/index.js", version: "1.0.0", sha256: "original" };
const report = resolutions => ({ schemaVersion: 1, node: process.version, vueShared: true, resolutions });
it("compares normalized results while accepting output order differences", () => {
  const browser = { ...row, mode: "vite-client", target: "node_modules/sdk/browser.js" };
  expect(comparePmInstallResolutions(report([row, browser]), report([browser, row]))).toEqual([]);
});
for (const change of [{ target: "node_modules/other/index.js" }, { version: "2.0.0" }, { sha256: "changed" }]) {
  it(`rejects resolution drift ${Object.keys(change)[0]}`, () => {
    expect(comparePmInstallResolutions(report([row]), report([{ ...row, ...change }]))).toHaveLength(1);
  });
}
it("does not accept lost/duplicate entries or incomplete environment evidence", () => {
  const browser = { ...row, mode: "vite-client" };
  expect(comparePmInstallResolutions(report([row, browser]), report([row]))).toHaveLength(1);
  expect(() => comparePmInstallResolutions(report([row, row]), report([row]))).toThrow("Duplicate");
  expect(() => comparePmInstallResolutions(report([]), report([]))).toThrow("incomplete");
  expect(() => comparePmInstallResolutions(report([row]), { ...report([row]), vueShared: false })).toThrow("incomplete");
  expect(() => comparePmInstallResolutions(report([row]), { ...report([row]), node: "other" })).toThrow("incomplete");
});
