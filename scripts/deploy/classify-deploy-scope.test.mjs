import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDeployScope, resolveDeployScope } from "./classify-deploy-scope.mjs";

describe("classifyDeployScope", () => {
  it("frontend-only for client/web", () => {
    assert.equal(classifyDeployScope(["client/web/src/App.vue"]), "frontend");
    assert.equal(classifyDeployScope(["client/web/.env.production"]), "frontend");
  });

  it("backend-only for server paths", () => {
    assert.equal(classifyDeployScope(["server/backend/server.js"]), "backend");
    assert.equal(classifyDeployScope(["server/match/matcher/index.js"]), "backend");
    assert.equal(classifyDeployScope(["deploy/scripts/deploy-server-remote.sh"]), "backend");
  });

  it("full when shared adapter / packages change", () => {
    assert.equal(classifyDeployScope(["packages/venue-adapter/ob/index.ts"]), "full");
    assert.equal(classifyDeployScope(["packages/shared/foo.js"]), "full");
  });

  it("full when both sides change", () => {
    assert.equal(
      classifyDeployScope(["client/web/src/x.ts", "server/backend/server.js"]),
      "full",
    );
  });

  it("noop for docs / workflow-only", () => {
    assert.equal(classifyDeployScope(["PRODUCTION_DEPLOYMENT.md", "docs/ARCHITECTURE.md"]), "noop");
    assert.equal(classifyDeployScope([".github/workflows/deploy.yml"]), "noop");
    assert.equal(classifyDeployScope(["chrome-extension/manifest.json"]), "noop");
  });

  it("unknown path is full", () => {
    assert.equal(classifyDeployScope(["mystery/tool.js"]), "full");
  });

  it("root dependency/build inputs affect both sides", () => {
    for (const p of ["package.json", "package-lock.json", "turbo.json"])
      assert.equal(classifyDeployScope([p]), "full");
  });
});

describe("resolveDeployScope", () => {
  it("forceFull wins", () => {
    assert.equal(resolveDeployScope({ forceFull: true, paths: ["client/web/a.ts"] }).scope, "full");
  });

  it("unknown git base → full", () => {
    assert.equal(resolveDeployScope({ from: "0000000", to: "abc", execSync: () => "" }).scope, "full");
  });
});
