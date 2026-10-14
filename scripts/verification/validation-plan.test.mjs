import { expect, it } from "vitest";
import { parseValidationArgs, validationPlan } from "./validation-plan.mjs";

it.each([
  [["docs/note.md"], "docs"], [["client/web/src/components/admin/Report.vue"], "frontend"],
  [["server/backend/core/observability/memory.js"], "backend"],
  [["server/storage/runtime_version.js"], "integration"],
  [["server/db/rds/orders_store.js"], "full"], [["client/web/src/orderModes/gtc/pollingPolicy.ts"], "full"],
  [["client/web/src/stores/account/betGateway.ts"], "full"], [["packages/shared/new.ts"], "full"],
  [["scripts/verification/validation-plan.mjs"], "full"], [["server/backend/http_routes.js"], "full"],
  [["server/backend/core/shared/parse_form_bool.js"], "full"], [["server/backend/core/http/security_headers.js"], "full"],
  [["server/storage/auth_mode.js"], "full"], [["server/collectors/polymarket-esports/api.js"], "full"],
  [["unknown/new.js"], "full"], [[], "full"],
])("%j selects %s with immutable FOK protection", (paths, tier) => {
  const plan = validationPlan(paths); expect(plan.tier).toBe(tier); expect(plan.immutableFokEntries).toBe(551);
  expect(plan.checks).toContain(tier === "full" ? "complete-release" : "fok-551"); expect(plan.snapshotOverridesAllowed).toBe(false);
});
it("a critical deleted or renamed path cannot be hidden by unrelated documents", () => {
  expect(validationPlan(["docs/plan.md", "server/db/old.js", "client/web/src/components/admin/new.vue"]).tier).toBe("full");
  expect(validationPlan(["server\\db\\orders.js"]).tier).toBe("full");
});
it.each(["--skip-fok", "--tier=docs", "--level=fast", "--base=-bad", "--release-plan=none"])("rejects unsafe selection %s", arg => expect(() => parseValidationArgs([arg])).toThrow());
it("rejects ambiguous or malformed scope", () => {
  expect(() => parseValidationArgs(["--staged", "--base=HEAD"])).toThrow();
  expect(() => parseValidationArgs(["--plan", "--plan"])).toThrow();
  expect(() => validationPlan(["../orders.js"])).toThrow();
});
