import {adapterCanonicalFile} from "./browser-entry-history.mjs";
import {sourceFixture} from './fixtures/source-fixture.mjs';
import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { PM_FOLDER_RELOCATIONS, certifyPmFolderRelease, checkPmFolderFreeze } from "./pm-folder-release-boundary.mjs";
import { PM_UNIFIED_PREFLIGHT_HELPERS } from "./pm-unified-preflight-boundary.mjs";
import { restoreVenueBrowserExecution } from './venue-browser-execution.mjs';
const manifestFile = "packages/venue-adapter/esport-freeze.json";
const read = sourceFixture(withAdapterHistoryReader(file => readAdapterHistory(file, "utf8")));
const manifest = read(manifestFile);
const sources = new Map();
const gitRead = (base, file) => {
  const key = `${base}:${file}`;
  if (!sources.has(key)) sources.set(key, execFileSync("git", ["show", key], { encoding: "utf8" }));
  return sources.get(key);
};
describe("independent PM folder release protection", () => {
  it("certifies all 83 complete implementations against immutable source and FOK/VPS references", () => {
    expect(Object.keys(PM_FOLDER_RELOCATIONS)).toHaveLength(83);
    expect(Object.keys(PM_UNIFIED_PREFLIGHT_HELPERS)).toHaveLength(5);
    expect(certifyPmFolderRelease(manifest, read, gitRead).size).toBe(167 + 5);
  }, 30_000); // Reads 83 historical files through Git; keep assertions intact under CI load.
  for (const [file, target] of Object.entries(PM_FOLDER_RELOCATIONS)) {
    it(`${target}: rejects an execution statement change`, () => {
      expect(() => certifyPmFolderRelease(manifest, f => read(f) + (f === target ? "\nthrow Error('changed');\n" : ""), gitRead)).toThrow();
    });
    it(`${file}: rejects extra wrapper behavior`, () => {
      expect(() => certifyPmFolderRelease(manifest, f => read(f) + (f === file ? "\nvoid 0;\n" : ""), gitRead)).toThrow();
    });
  }
  it("rejects a changed dependency path even if the function bodies stay the same", () => {
    const file = "packages/venue-adapter/polymarket/fok/bet.ts";
    const previous = restoreVenueBrowserExecution(file, read(file));
    expect(previous).toContain('"../orderTrace"');
    expect(() => certifyPmFolderRelease(manifest, f => f === file ? previous.replace('"../orderTrace"', '"../otherTrace"') : read(f), gitRead)).toThrow();
  });
  it("rejects any edit of the original freeze manifest", () => {
    expect(() => certifyPmFolderRelease(manifest + "\n", read, gitRead)).toThrow("original freeze manifest unchanged");
  });
  it("keeps unrelated frozen paths and unregistered FOK files protected", () => {
    const changed = ["client/web/src/stores/oddsStore.ts", "packages/venue-adapter/polymarket/fok/extra.ts", "packages/venue-adapter/polymarket/fok/extra.md"];
    expect(checkPmFolderFreeze(changed, manifest, read, gitRead).hits).toEqual(changed.filter(f=>f!=="client/web/src/stores/oddsStore.ts"));
    expect(checkPmFolderFreeze(changed, manifest, read, gitRead).certifiedHits).toContain("client/web/src/stores/oddsStore.ts");
  });
  it("accepts only registered proven old and new module paths", () => {
    const changed = Object.entries(PM_FOLDER_RELOCATIONS).flat();
    expect(checkPmFolderFreeze(changed, manifest, read, gitRead).hits).toEqual([]);
  });
  it("default CLI rejects a missing diff base without an allowance", () => {
    const result = spawnSync(process.execPath, ["packages/venue-adapter/scripts/check-esport-freeze.mjs"], {
      encoding: "utf8", env: { ...process.env, ALLOW_ESPORT_TOUCH: "", ESPORT_FREEZE_BASE: "missing-pm-folder-release-base" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-pm-folder-release-base");
  });
  for (const file of ["packages/venue-adapter/polymarket/bet.ts", "packages/venue-adapter/polymarket/fok/bet.ts"]) {
    it(`default CLI rejects tampering with ${file}`, () => {
      const injection = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
        const original = fs.readFileSync;
        fs.readFileSync = function(p, ...args) { const s = original.call(this, p, ...args); return typeof s === 'string' && String(p).replaceAll('\\\\','/').endsWith(${JSON.stringify(adapterCanonicalFile(file))}) ? s + '\\nvoid 0;\\n' : s; };
        syncBuiltinESMExports(); await import('./packages/venue-adapter/scripts/check-esport-freeze.mjs');`;
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", injection], {
        encoding: "utf8", env: { ...process.env, ALLOW_ESPORT_TOUCH: "", ESPORT_FREEZE_BASE: "HEAD" },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/AssertionError/);
    });
  }
});
