import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, it } from "vitest";
import { ADAPTER_BROWSER_RELOCATION, readAdapterBrowserSource, restoreAdapterBrowserSource,
  inspectAdapterBrowserRelocation, verifyAdapterBrowserRelocation } from "./adapter-browser-relocation.mjs";

const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
describe("remaining browser adapter physical isolation", () => {
  it("preserves all complete source bodies and legacy module identities", () => {
    assert.deepEqual(inspectAdapterBrowserRelocation(process.cwd()), { files: 595, implementations: 180 });
    const certified = verifyAdapterBrowserRelocation(read);
    assert.equal(certified.size, 1190);
  });
  for (const file of ["ob/collect.ts", "pb/bet.ts", "predictfun/collect.ts", "ray/index.ts", "registry/adapters.ts"])
    it(`rejects implementation mutation behind ${file}`, () => {
      const row = ADAPTER_BROWSER_RELOCATION.records.find(item => item.file === `packages/venue-adapter/${file}`);
      assert(row && !row.copiedOnly);
      const source = read(row.canonical);
      assert.throws(() => readAdapterBrowserSource(row.file, row.wrapper,
        target => target === row.canonical ? source + "\nthrow Error('unexpected execution');\n" : read(target)), /relocated source changed/);
      assert.throws(() => verifyAdapterBrowserRelocation(target => target === row.file ? row.wrapper + "\nexport const hidden = true;\n" : read(target)), /exact compatibility entry/);
    });
  it("rejects changed import targets and keeps the original baseline fixed", () => {
    const row = ADAPTER_BROWSER_RELOCATION.records.find(item => item.replacements.length && !item.copiedOnly);
    const edit = row.replacements[0], source = read(row.canonical);
    assert.throws(() => restoreAdapterBrowserSource(row, source.replace(edit.after, '"./unexpected"')));
    assert.equal(ADAPTER_BROWSER_RELOCATION.baselineCommit, "c3bf0ac3e20d5221dfc36a79fc3a01f5487af9e1");
  });
});
