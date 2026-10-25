import {readAdapterHistory} from "./browser-entry-history.mjs";
import {sourceFixture} from './fixtures/source-fixture.mjs';
import assert from "node:assert/strict";
// [changmen 扩展] 正负向验证逐段还原与完整基线，不调用真实平台。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreRayFinalizeSource } from "./ray-frontend-boundary.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";
import { restoreA8MakeupTiming } from "./a8-makeup-timing-boundary.mjs";
import { readReviewedCapabilityContracts, restoreUnifiedArbitrageSource, UNIFIED_ARBITRAGE_BOUNDARIES, verifyUnifiedArbitrageContract } from "./unified-arb-boundaries.mjs";

const read = sourceFixture(file => readAdapterHistory(file, "utf8"));
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
const prior = "e901bb596952256284cd8a9eb8b73b572c963915";
const verify = (file, source, base) => verifyProtectedSource(file, source, gitSource(base, file), read, target => gitSource(base, target));
describe("unified public phases preserve complete immutable baselines", () => {
  for (const [file, boundaries] of Object.entries(UNIFIED_ARBITRAGE_BOUNDARIES)) {
    it(`${file}: restores precisely to the pre-unification served source`, () => {
      expect(moduleTokens(restoreRayFinalizeSource(file, restoreUnifiedArbitrageSource(file, read(file), replaceExact, true), replaceExact))).toEqual(moduleTokens(gitSource(prior, file)));
    });
    for (const base of bases) {
      it(`${file}/${base}: retains complete original-module protection`, () => {
        expect(verify(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`${file}/${base}: rejects additional trading actions outside registered fragments`, () => {
        expect(() => verify(file, `${read(file)}\nvoid unexpectedTradingAction();\n`, base)).toThrow();
      });
    }
    boundaries.forEach(([before, after], index) => {
      it(`${file} boundary ${index}: rejects a missing or duplicated reviewed fragment`, () => {
        const previous = restoreA8MakeupTiming(file, restorePmPreflightSource(file, read(file)), replaceExact, gitSource);
        const absent = replaceExact(previous, before, after);
        expect(() => restoreUnifiedArbitrageSource(file, absent, replaceExact, true)).toThrow();
        const duplicate = replaceExact(previous, before, `${before}\n${before}`);
        expect(() => verifyUnifiedArbitrageContract(target => target === file ? duplicate : read(target), replaceExact)).toThrow();
      }, 30_000);
    });
  }
});
describe("reviewed single-leg capabilities are completely protected", () => {
  it("rejects rewriting the review snapshot to permit the unreviewed monitor action", () => {
    const source = read("scripts/verification/unified-arb-capability-contracts.json");
    expect(Object.keys(readReviewedCapabilityContracts(source))).toContain("client/web/src/orderModes/gtc/arbLeg.ts");
    const changed = source.replace("registerRejectMonitor: false", "registerRejectMonitor: true");
    expect(changed).not.toBe(source);
    expect(() => readReviewedCapabilityContracts(changed)).toThrow("immutable reviewed capability snapshot");
  });
  const contracts = JSON.parse(read("scripts/verification/unified-arb-capability-contracts.json"));
  it("requires all eleven public modules and four complete capability files", () => {
    expect(verifyUnifiedArbitrageContract(read, replaceExact)).toEqual({ precisePublicModules: 11, completeCapabilityContracts: 4 });
  });
  it("rejects reintroducing a mode-specific second-leg decision or losing submission cleanup", () => {
    const file = "client/web/src/domain/betting/originalLegExecution.ts";
    const source = read(file).replace("  submit: () => Promise<BetResult>;", "  submit: () => Promise<BetResult>;\n  canContinueOriginalPair: () => boolean;");
    expect(() => verifyUnifiedArbitrageContract(target => target === file ? source : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
    const bridge = "client/web/src/orderModes/gtc/arbLeg.ts";
    const leaked = read(bridge).replace("    finishSubmission,", "");
    expect(() => verifyUnifiedArbitrageContract(target => target === bridge ? leaked : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
  });
  it.each([
    ["clock renewal", "await prepared.prepareSubmit();", "prepared.validate();"],
    ["post-renewal session check", "await prepared.prepareSubmit(); checkSession();", "await prepared.prepareSubmit();"],
    ["exclude runtime preparation from persisted plan", "prepareSubmit: _prepareSubmit,", ""],
  ])("rejects removing the GTC %s correction while retaining the immutable snapshot", (_name, before, after) => {
    const file = "client/web/src/orderModes/gtc/arbLeg.ts";
    const changed = read(file).replace(before, after);
    expect(changed).not.toBe(read(file));
    expect(() => verifyUnifiedArbitrageContract(target => target === file ? changed : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
  });
  it.each(["retry", "makeup", "autoSell", "broadcast"])("rejects enabling the GTC %s action against the unchanged review contract", (action) => {
    const file = "client/web/src/orderModes/gtc/arbLeg.ts";
    const source = read(file).replace(`${action}: false`, `${action}: true`);
    expect(source).not.toBe(read(file));
    expect(() => verifyUnifiedArbitrageContract(target => target === file ? source : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
  });
  it("rejects disabling common RAY monitoring or enabling it for unrelated venues", () => {
    const file = "client/web/src/orderModes/gtc/arbLeg.ts";
    for (const replacement of ["true", "false"]) {
      const source = read(file).replace('registerRejectMonitor: otherAccount.provider === "RAY"', `registerRejectMonitor: ${replacement}`);
      expect(source).not.toBe(read(file));
      expect(() => verifyUnifiedArbitrageContract(target => target === file ? source : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
    }
  });
  for (const file of Object.keys(contracts)) {
    it(`${file}: rejects additional actions and rollback to an empty module`, () => {
      for (const source of [`${read(file)}\nvoid unexpectedTradingAction();\n`, "export {};\n"])
        expect(() => verifyUnifiedArbitrageContract(target => target === file ? source : read(target), replaceExact)).toThrow("complete reviewed unified capability contract");
    });
  }
  for (const [name, suffix, before, after] of [
    ["first-leg qualification", "phases/placeArbLegs.ts", "if (resultA.success)", "if (true)"],
    ["GTC-only lifecycle", "phases/checkArbLegs.ts", "ready.pmOrderMode === \"GTC\" &&", "true &&"],
    ["FOK retry permit", "phases/placeArbLegs.ts", "original?.actions.retry !== false", "true"],
    ["FOK money/check arguments", "phases/checkArbLegs.ts", "legA.type === \"Polymarket\" &&", "true &&"],
    ["reject countdown", "phases/settleBothArbLegs.ts", "Math.max(0,", "Math.min(0,"],
    ["monitor wait", "phases/settleBothArbLegs.ts", "rejectWaitSec ?? 0", "rejectWaitSec ?? 1"],
    ["makeup permission", "phases/finalizeArbBet.ts", "actions?.makeup === false", "false"],
    ["auto sell permission", "phases/finalizeArbBet.ts", "actions?.autoSell !== false", "true"],
    ["regular account history", "phases/prepareArbAttempt.ts", "readUsedAccounts(", "readGtcUsedAccounts("],
  ]) {
    const file = `client/web/src/stores/betting/autoBet/${suffix}`;
    it(`rejects changed ${name} against both original baselines`, () => {
      assert(read(file).includes(before), `mutation applies: ${name}`);
      for (const base of bases) expect(() => verify(file, read(file).replace(before, after), base)).toThrow();
    });
  }
  it("rejects an unregistered GTC injection in an ordinary phase", () => {
    const file = "client/web/src/stores/betting/autoBet/phases/finalizeArbMessaging.ts";
    expect(() => verify(file, read(file).replace("const { trace } = params;", "const { trace } = params; void accountStore.betting();"), bases[1])).toThrow();
  });
  it("ignores only comments/formatting, preserves await context and literal whitespace", () => {
    expect(replaceExact("async function f(){ /** doc */ const x = await request(\"a b\"); }", "const x = await request(\"a b\");", "")).toContain("async function f()");
    expect(() => replaceExact("const x = await request(\"a  b\");", "const x = await request(\"a b\");")).toThrow();
    expect(moduleTokens("post(`a b`);")).not.toEqual(moduleTokens("post(`a  b`);"));
  });
});
