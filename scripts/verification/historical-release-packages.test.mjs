import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { expect, it } from "vitest";
import { historicalPackages, verifyHistoricalPackage } from "./historical-release-packages.mjs";
import { createReadonlyGitScope } from "./orders-phase2-git-scope.mjs";
for (const spec of historicalPackages) {
  // Materializes the complete fixed Git release; cold Windows/parallel CI can exceed the 5s unit-test default.
  it(`${spec.version}: verifies the complete original version and original scope`, () => expect(verifyHistoricalPackage(spec).passed).toBe(true), 30000);
  it(`${spec.version}: rejects changed historical bytes`, () => expect(() => verifyHistoricalPackage(spec, { transformSource: (_, source) => source + "\nvoid unexpectedTrade();" })).toThrow("original release bytes"));
  it(`${spec.version}: rejects a rebaselined manifest`, () => expect(() => verifyHistoricalPackage(spec, { readMetadata: file => {
    const scope = JSON.parse(fs.readFileSync(file, "utf8")); scope.base = "0".repeat(40); return JSON.stringify(scope);
  } })).toThrow("immutable historical scope"));
  it(`${spec.version}: rejects paths outside the original range`, () => {
    const git = createReadonlyGitScope(), original = git.committedPaths;
    git.committedPaths = (...args) => [...original(...args), "server/extra.js"];
    expect(() => verifyHistoricalPackage(spec, { git })).toThrow("historical release path range");
  });
}
it("cannot replace a historical candidate with current HEAD", () => expect(() => verifyHistoricalPackage({ ...historicalPackages[0], version: "HEAD" })).toThrow("original historical package"));
