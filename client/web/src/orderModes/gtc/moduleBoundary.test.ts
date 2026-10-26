import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the single-order core free of business, legacy records, stores and UI", () => {
  const files = [new URL("../../../../../packages/shared/pm_gtc_order.ts", import.meta.url),
    ...readdirSync(new URL("./core/", import.meta.url)).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => new URL(`./core/${name}`, import.meta.url))];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file.pathname).not.toMatch(/GtcPlan|GtcExecution|otherPlayerId|groupComplete|compatibility\/|@\/stores\/|from ["'](?:vue|pinia|element-plus)["']/);
  }
});
it("PM GTC transport consumes only single-order contracts", () => {
  const file = new URL("../../../../../client/packages/venue-browser/polymarket/gtc/index.ts", import.meta.url);
  const source = readFileSync(file, "utf8");
  expect(source).not.toMatch(/\bGtcPlan\b|shared\/pm_gtc["']/);
  expect(source).toContain("GtcOrderReference");
});
it("new creation, persistence and monitoring never convert orders into a paired execution", () => {
  for (const name of ["orders.ts", "orderStore.ts", "orderRuntime.ts", "orderState.ts", "manual.ts"]) {
    const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    expect(source, name).not.toMatch(/singleOrderLegacyPlan|GtcPlan|GtcExecution|authorize_other|originalPmLeg|otherPlayerId|groupComplete|\.\/api["']|\.\/executionState["']/);
  }
});
