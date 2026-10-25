import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDeployScope, resolveDeployScope, listChangedPaths } from "./classify-deploy-scope.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";

describe("classifyDeployScope", () => {
  it("frontend-only for client/web", () => {
    assert.equal(classifyDeployScope(["client/web/src/App.vue"]), "frontend");
    assert.equal(classifyDeployScope(["client/web/.env.production"]), "frontend");
  });

  it("backend-only for server paths", () => {
    assert.equal(classifyDeployScope(["server/backend/server.js"]), "backend");
    assert.equal(classifyDeployScope(["server/match/matcher/index.js"]), "backend");
    assert.equal(classifyDeployScope(["deploy/scripts/deploy-server-remote.sh"]), "backend");
    for (const file of ["server/venues/loader/adapter_paths.mjs", "server/venues/registry/runtime/ob/node/session.js",
      "server/venues/package.json", "server/venues/sync-backend-bundle.mjs", "rds/pg_pool.js"])
      assert.equal(classifyDeployScope([file]), "backend", file);
  });

  it("publishes each relocated browser implementation and its build tools only to the frontend", () => {
    for (const file of ["client/packages/client-core/src/shared/http.ts", "client/packages/arb-core/src/index.ts",
      "client/packages/venue-browser/polymarket/fok/bet.ts", "client/packages/venue-browser/package.json",
      "client/packages/pm-market-data-browser/src/marketData.worker.ts", "client/devtools/venue-adapter/sync-package-exports.mjs"])
      assert.equal(classifyDeployScope([file]), "frontend", file);
  });

  it("covers every active workspace while keeping shared contracts and build tooling joint", () => {
    for (const { dir } of readInstallWorkspaces(process.cwd()).values()) {
      const expected = dir === "chrome-extension" ? "noop" : dir.startsWith("client/") ? "frontend"
        : dir.startsWith("server/") || dir === "rds" ? "backend" : "full";
      assert.equal(classifyDeployScope([dir + "/package.json"]), expected, dir);
    }
  });

  it("CI-only changes do not restart applications; production transport changes retain their scope", () => {
    for (const file of ["scripts/deploy/classify-deploy-scope.mjs", "scripts/deploy/change-plan.mjs",
      "scripts/deploy/release-checks.mjs", "scripts/deploy/backend-install-profile.test.mjs", "scripts/deploy/release.test.sh",
      "scripts/deploy/fixtures/backend-installation.mjs", "scripts/verification/source-ownership-inputs.json",
      "scripts/testing/backend-linux-runtime.mjs", "scripts/check-team-boundaries.mjs"])
      assert.equal(classifyDeployScope([file]), "noop", file);
    assert.equal(classifyDeployScope(["scripts/deploy/install-backend.mjs"]), "backend");
    assert.equal(classifyDeployScope(["scripts/deploy/acceptance-contract.mjs"]), "full");
    assert.equal(classifyDeployScope(["scripts/deploy/compare-deployed-files.mjs"]), "full");
    assert.equal(classifyDeployScope(["scripts/deploy/example.test.mjs.runtime.js"]), "full");
    assert.equal(classifyDeployScope(["scripts/deploy/unreviewed-helper.mjs"]), "full");
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
  it("keeps relocated Node identity tools shared by Vite and backend in full publication", () => {
    for (const file of ["devtools/runtime-tooling/runtime_version.js", "devtools/runtime-tooling/dev_web_port.js",
      "devtools/runtime-tooling/runtime_version.d.ts", "devtools/runtime-tooling/package.json", "packages/shared/tooling/package.json"])
      assert.equal(classifyDeployScope([file]), "full");
    assert.equal(classifyDeployScope(["devtools/platform-probes/ob/core.js"]), "backend");
  });

  it("noop for docs / workflow-only", () => {
    assert.equal(classifyDeployScope(["PRODUCTION_DEPLOYMENT.md", "docs/ARCHITECTURE.md"]), "noop");
    assert.equal(classifyDeployScope([".github/workflows/deploy.yml"]), "noop");
    assert.equal(classifyDeployScope(["chrome-extension/manifest.json"]), "noop");
  });

  it("unknown path is full", () => {
    assert.equal(classifyDeployScope(["mystery/tool.js"]), "full");
    assert.equal(classifyDeployScope(["client/packages/unreviewed/index.ts"]), "full");
    for (const file of ["client/web/../../server/secret.js", "/client/web/main.ts", "C:\\client\\web\\main.ts"])
      assert.equal(classifyDeployScope([file]), "full");
    assert.equal(classifyDeployScope([".\\client\\packages\\venue-browser\\index.ts"]), "frontend");
  });

  it("root dependency/build inputs affect both sides", () => {
    for (const p of ["package.json", "package-lock.json", "turbo.json"])
      assert.equal(classifyDeployScope([p]), "full");
  });
  it("shared retention and common transport affect both components; frontend activation stays frontend", () => {
    assert.equal(classifyDeployScope(["scripts/deploy/release-retention.mjs"]), "full");
    assert.equal(classifyDeployScope(["deploy/scripts/release-common.sh"]), "full");
    assert.equal(classifyDeployScope(["deploy/scripts/release-frontend.sh"]), "frontend");
  });
});

it("legacy diff consumers keep both sides of renames and NUL-delimited filenames", () => {
  const paths = listChangedPaths("before", "after", { execFileSync: (bin, args) => {
    assert.equal(bin, "git"); assert.deepEqual(args, ["diff", "--no-renames", "--name-only", "-z", "before", "after"]);
    return "client/packages/client-core/old.ts\0server/venues/new.ts\0";
  } });
  assert.equal(classifyDeployScope(paths), "full");
});

describe("resolveDeployScope", () => {
  it("forceFull wins", () => {
    assert.equal(resolveDeployScope({ forceFull: true, paths: ["client/web/a.ts"] }).scope, "full");
  });

  it("unknown git base → full", () => {
    assert.equal(resolveDeployScope({ from: "0000000", to: "abc", execSync: () => "" }).scope, "full");
  });
});
