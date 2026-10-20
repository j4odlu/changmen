import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { rebasePmFokImports } from "./pm-fok-source-relocation.mjs";
import { PM_UNIFIED_PREFLIGHT_HELPERS, restorePmUnifiedPreflightSource, verifyPmUnifiedPreflightContract } from "./pm-unified-preflight-boundary.mjs";
const readBeforeExecution = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n"));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const changes = JSON.parse(read("scripts/verification/pm-unified-preflight-increments.json"));
describe("independent PM preflight and selectable online FOK policy", () => {
  it.each([
    ['prepared?.preflightMode === "optimized"', 'option.data?.pmPreflightMode !== "legacy"'],
    ['prepared.preflightMode === "optimized"', 'capturePmFokPreflightMode(option) !== "legacy"'],
    ['if (prepared.preflightMode === "optimized")', 'if (true)'],
  ])("rejects replacing captured preparation policy: %s", (before, after) => {
    const file = "packages/venue-adapter/polymarket/fok/bet.ts";
    expect(read(file)).toContain(before);
    expect(() => verifyPmUnifiedPreflightContract(target => target === file ? read(file).replace(before, after) : read(target)))
      .toThrow("exact captured FOK mode isolation");
  });
  it("verifies every registered module and dependency without replacing original baselines", () => {
    expect(() => verifyPmUnifiedPreflightContract(read)).not.toThrow();
  });
  it.each(Object.keys(PM_UNIFIED_PREFLIGHT_HELPERS))("rejects behavioral mutations anywhere in %s", file => {
    expect(() => verifyPmUnifiedPreflightContract(target => read(target) + (target === file ? "\nvoid unexpectedOrder();" : ""))).toThrow();
  });
  it.each(Object.keys(changes))("rejects deleting the new behavior or adding unrelated code: %s", file => {
    expect(() => verifyPmUnifiedPreflightContract(target => target === file
      ? restorePmUnifiedPreflightSource(file, read(file), true) : read(target))).toThrow();
    expect(() => verifyPmUnifiedPreflightContract(target => read(target) + (target === file ? "\nvoid unexpectedOrder();" : ""))).toThrow();
  });
  it.each([
    ["markets/pmSportGamma.ts", "submission/preflight/legacy/pmSportGamma.ts"],
    ["submission/preflight/pmBetGuard.ts", "submission/preflight/legacy/pmBetGuard.ts"],
  ])("retains deployed 1632d690 behavior verbatim for %s, adjusting imports only", (from, to) => {
    const root = "packages/venue-adapter/polymarket/";
    let expected = rebasePmFokImports(gitSource("1632d6905061f56fcc7af7039914ca26d743ed48", root + from), root + from, root + to);
    if (to.endsWith("pmBetGuard.ts")) expected = expected.replace('from "../../../pmSportGamma"', 'from "./pmSportGamma"');
    expect(read(root + to).split("\n").slice(1).join("\n")).toBe(expected);
  });
});
