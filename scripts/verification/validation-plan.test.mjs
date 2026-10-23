import { expect, it } from "vitest";
import { parseValidationArgs, validationPlan } from "./validation-plan.mjs";

it.each([
  [["docs/note.md"], "docs"], [["client/web/src/components/admin/Report.vue"], "frontend"],
  [["server/backend/core/observability/memory.js"], "backend"],
  [["server/storage/runtime_version.js"], "integration"],
  [["rds/rds/orders_store.js"], "full"], [["client/web/src/orderModes/gtc/pollingPolicy.ts"], "full"],
  [["client/web/src/stores/account/betGateway.ts"], "full"], [["packages/shared/new.ts"], "full"],
  [["client/web/src/domain/betting/originalLegExecution.ts"], "full"], [["client/web/src/App.vue"], "full"],
  [["scripts/verification/validation-plan.mjs"], "controls"], [["scripts/deploy/publish.sh"], "controls"],
  [[".github/workflows/release.yml"], "controls"], [["server/backend/http_routes.js"], "full"],
  [["server/backend/core/shared/parse_form_bool.js"], "full"], [["server/backend/core/http/security_headers.js"], "full"],
  [["server/storage/auth_mode.js"], "full"], [["server/collectors/polymarket-esports/api.js"], "full"],
  [["unknown/new.js"], "full"], [[], "full"],
])("%j selects %s without an implicit historical FOK audit", (paths, tier) => {
  const plan = validationPlan(paths); expect(plan.tier).toBe(tier); expect(plan.immutableFokEntries).toBe(0);
  expect(plan.checks).not.toContain("fok-551"); expect(plan.checks).not.toContain("complete-release"); expect(plan.snapshotOverridesAllowed).toBe(false);
});
it("core changes retain both local suites without contacting a live release", () => {
  const plan = validationPlan(["client/web/src/orderModes/gtc/runtime.ts"]);
  for (const check of ["backend", "frontend-typecheck", "frontend", "build"])
    expect(plan.checks).toContain(check);
  for (const check of ["fok-551", "verification-control", "verification-node"])
    expect(plan.checks).not.toContain(check);
  expect(plan.checks).not.toContain("boundaries"); // backend already runs these checks
  expect(plan.checks).not.toContain("complete-release");
});
it("publication runs component tests and builds; full audit is not implicit", () => {
  expect(validationPlan(["client/web/src/components/admin/Report.vue"], { publication: true, components: ["frontend"] }).checks)
    .toEqual(["validation-control", "boundaries", "frontend", "build"]);
  expect(validationPlan([], { publication: true, components: ["backend"] }).checks)
    .toEqual(["validation-control", "router-compile", "backend"]);
  const tools = validationPlan(["scripts/deploy/publish.sh"]);
  expect(tools.checks).toContain("validation-control");
  expect(tools.checks).not.toContain("verification-control");
  for (const check of ["frontend", "backend", "build", "complete-release"]) expect(tools.checks).not.toContain(check);
});
it("deploy-only changes require build and control tests without repeating unchanged application suites", () => {
  const plan = validationPlan(["scripts/deploy/publish.sh", "deploy/scripts/release-backend.sh"], { publication: true });
  expect(plan.checks).toEqual(["validation-control", "boundaries", "router-compile", "build"]);
  for (const check of ["backend", "frontend", "complete-release", "verification-control"]) expect(plan.checks).not.toContain(check);
});
it("publication has no FOK/live audit gate, while changed verification code retains its own tests", () => {
  for (const paths of [[], ["packages/shared/catalog/game_catalog.json"], ["server/backend/core/account/order_store.js"], ["scripts/verification/pm-dependency-audit.mjs"]]) {
    const plan = validationPlan(paths, { publication: true });
    expect(plan.immutableFokEntries).toBe(0);
    expect(plan.checks).not.toContain("fok-551"); expect(plan.checks).not.toContain("complete-release");
    expect(plan.checks.includes("verification-control")).toBe(paths.some(file => file.startsWith("scripts/verification/")));
  }
});
it.each([false, true])("validation entry changes run dedicated regression in release=%s", release => {
  for (const file of ["validation-plan.mjs", "verify-change.mjs", "validation-plan.test.mjs", "verify-change.test.mjs"]) {
    const plan = validationPlan([`scripts/verification/${file}`], { release, publication: release });
    expect(plan.checks).toContain("validation-control");
    expect(plan.checks).not.toContain("verification-control");
    expect(plan.checks).not.toContain("verification-node");
    expect(validationPlan([`scripts/verification/${file}`, "scripts/verification/unknown-new-helper.mjs"], { release, publication: release }).checks)
      .toContain("verification-control");
  }
});
it("documents and unrelated application changes do not run the historical verifier suite", () => {
  expect(validationPlan(["docs/note.md"]).checks).toEqual(["validation-control"]);
  for (const file of ["client/web/src/components/admin/Report.vue", "client/web/src/runtime/obSportFootballFetch.ts",
    "server/backend/core/admin_tools/user_log_lookup.js", "rds/rds/orders_store.js", "unknown/new.js"]) {
    const plan = validationPlan([file]);
    for (const check of ["fok-551", "verification-control", "verification-node"])
      expect(plan.checks).not.toContain(check);
  }
});
it("changed verifier code retains its own regression even alongside unrelated documents or application code", () => {
  for (const paths of [["scripts/verification/fok-exact-boundaries.mjs"],
    ["docs/note.md", "scripts/verification/deleted-helper.mjs"],
    ["client/web/src/components/admin/Report.vue", "scripts/verification/new-helper.mjs"]]) {
    const plan = validationPlan(paths);
    expect(plan.checks).toContain("verification-control");
    expect(plan.checks).toContain("verification-node");
    expect(plan.checks).not.toContain("fok-551");
  }
});
it("a critical deleted or renamed path cannot be hidden by unrelated documents", () => {
  expect(validationPlan(["docs/plan.md", "rds/old.js", "client/web/src/components/admin/new.vue"]).tier).toBe("full");
  expect(validationPlan(["server\\db\\orders.js"]).tier).toBe("full");
});
it.each(["--skip-fok", "--tier=docs", "--level=fast", "--base=-bad", "--release-plan=none"])("rejects unsafe selection %s", arg => expect(() => parseValidationArgs([arg])).toThrow());
it("rejects ambiguous or malformed scope", () => {
  expect(() => parseValidationArgs(["--staged", "--base=HEAD"])).toThrow();
  expect(() => parseValidationArgs(["--plan", "--plan"])).toThrow();
  expect(() => validationPlan(["../orders.js"])).toThrow();
});
