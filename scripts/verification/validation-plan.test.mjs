import { expect, it } from "vitest";
import { parseValidationArgs, validationPlan } from "./validation-plan.mjs";

it.each([
  [["docs/note.md"], "docs"], [["client/web/src/components/admin/Report.vue"], "frontend"],
  [["client/web/src/orderModes/gtc/pollingPolicy.ts"], "frontend"],
  [["client/web/src/stores/account/betGateway.ts"], "frontend"],
  [["client/web/src/domain/betting/originalLegExecution.ts"], "frontend"], [["client/web/src/App.vue"], "frontend"],
  [["client/packages/venue-browser/adapter/polymarket/execute.ts"], "frontend"],
  [["client/packages/arb-core/src/arbitrage/check.ts"], "frontend"],
  [["server/backend/core/observability/memory.js"], "backend"],
  [["server/backend/http_routes.js"], "backend"], [["server/backend/core/http/security_headers.js"], "backend"],
  [["server/backend/core/account/order_store.js"], "backend"], [["server/storage/auth_mode.js"], "backend"],
  [["rds/rds/orders_store.js"], "backend"], [["rds/assets/schema.sql"], "backend"],
  [["server/collectors/polymarket-esports/api.js"], "backend"],
  [["server/storage/runtime_version.js"], "full"], [["packages/shared/new.ts"], "full"],
  [["scripts/verification/validation-plan.mjs"], "controls"], [["scripts/deploy/publish.sh"], "controls"],
  [[".github/workflows/release.yml"], "controls"], [["unknown/new.js"], "full"], [[], "full"],
])("%j selects %s by component ownership", (paths, tier) => {
  const plan = validationPlan(paths);
  expect(plan.tier).toBe(tier);
  expect(plan.immutableFokEntries).toBe(0);
  for (const check of ["fok-551", "complete-release", "frontend-typecheck"])
    expect(plan.checks).not.toContain(check);
  expect(plan.snapshotOverridesAllowed).toBe(false);
});
it("frontend order changes keep the complete frontend suite and one typed build", () => {
  expect(validationPlan(["client/web/src/orderModes/gtc/runtime.ts"]).checks)
    .toEqual(["boundaries", "frontend", "build"]);
  expect(validationPlan(["client/web/src/orderModes/fok/execute.ts"]).checks)
    .toEqual(["boundaries", "frontend", "build"]);
});
it("backend changes keep backend and shared tests without unrelated frontend tests", () => {
  expect(validationPlan(["server/backend/core/account/order_store.js"]).checks).toEqual(["router-compile", "backend"]);
  expect(validationPlan(["rds/rds/orders_store.js"]).checks).toEqual(["router-compile", "backend"]);
});
it("shared or unknown code and empty selections remain conservative", () => {
  for (const paths of [["packages/shared/rules.js"], ["unknown/file.ts"], []])
    expect(validationPlan(paths).checks).toEqual(["router-compile", "backend", "frontend", "build"]);
  expect(validationPlan(["server/backend/server.js", "client/web/src/App.vue"]).tier).toBe("integration");
});
it("publication checks only the selected components", () => {
  expect(validationPlan([], { publication: true, components: ["frontend"] }).checks)
    .toEqual(["boundaries", "frontend", "build"]);
  expect(validationPlan([], { publication: true, components: ["backend"] }).checks)
    .toEqual(["router-compile", "backend"]);
});
it("deploy-only changes build without repeating unchanged application suites", () => {
  expect(validationPlan(["scripts/deploy/publish.sh", "deploy/scripts/release-backend.sh"], { publication: true }).checks)
    .toEqual(["boundaries", "router-compile", "build"]);
});
it.each([false, true])("planner changes run their own regressions in release=%s", release => {
  for (const file of ["validation-plan.mjs", "verify-change.mjs", "validation-plan.test.mjs", "verify-change.test.mjs"]) {
    const plan = validationPlan([`scripts/verification/${file}`], { release, publication: release });
    expect(plan.checks).toContain("validation-control");
    expect(plan.checks).not.toContain("verification-control");
    expect(plan.checks).not.toContain("verification-node");
  }
  expect(validationPlan(["scripts/deploy/change-plan.mjs"]).checks).toContain("validation-control");
});
it("documents require no executable checks; ordinary application changes do not test the checkers", () => {
  expect(validationPlan(["docs/note.md"]).checks).toEqual([]);
  for (const file of ["client/web/src/App.vue", "server/backend/server.js", "rds/rds/orders_store.js", "unknown/new.js"])
    for (const check of ["validation-control", "verification-control", "verification-node"])
      expect(validationPlan([file]).checks).not.toContain(check);
});
it("other verifier changes keep their complete regression, including mixed diffs", () => {
  for (const paths of [["scripts/verification/fok-exact-boundaries.mjs"],
    ["docs/note.md", "scripts/verification/deleted-helper.mjs"],
    ["client/web/src/App.vue", "scripts/verification/new-helper.mjs"]]) {
    const plan = validationPlan(paths);
    expect(plan.checks).toContain("verification-control");
    expect(plan.checks).not.toContain("verification-node");
  }
});
it("deletions, both sides of a rename, and Windows paths keep the appropriate suites", () => {
  expect(validationPlan(["docs/note.md", "rds/old.js", "client/web/src/components/admin/new.vue"]).tier).toBe("integration");
  expect(validationPlan(["server\\db\\orders.js"]).tier).toBe("backend");
});
it.each(["--skip-fok", "--tier=docs", "--level=fast", "--base=-bad", "--release-plan=none"])("rejects unsafe selection %s", arg => expect(() => parseValidationArgs([arg])).toThrow());
it("rejects ambiguous or malformed scope", () => {
  expect(() => parseValidationArgs(["--staged", "--base=HEAD"])).toThrow();
  expect(() => parseValidationArgs(["--plan", "--plan"])).toThrow();
  expect(() => validationPlan(["../orders.js"])).toThrow();
});
