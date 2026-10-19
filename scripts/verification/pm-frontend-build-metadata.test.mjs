import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { PM_METADATA_BASELINE, restorePmFrontendBuildMetadata, restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";
const record = JSON.parse(readAdapterHistory(new URL("./pm-frontend-build-metadata.json", import.meta.url), "utf8"));
for (const { file, patches } of record.changes) {
  const current = readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n"), original = gitSource(PM_METADATA_BASELINE, file);
  it(`${file}: restores the complete previous stage and original historical source`, () => {
    const previous = restorePmFrontendBuildMetadata(file, current);
    expect(previous).not.toBe(current);
    expect(restorePmSourceIsolationMetadata(file, previous, original)).toBe(original);
    expect(restorePmSourceIsolationMetadata(file, current, original)).toBe(original);
  });
  it(`${file}: does not accept extra content or a redirected Node tooling target`, () => {
    expect(() => restorePmSourceIsolationMetadata(file, current + "\n", original)).toThrow("exact registered");
    const changed = current.replace(file === "package-lock.json" ? '"file:../../packages/shared"' : '"./tooling/runtime_version.js"', '"file:../backend"');
    expect(changed).not.toBe(current);
    expect(() => restorePmSourceIsolationMetadata(file, changed, original)).toThrow("exact registered");
  });
}
