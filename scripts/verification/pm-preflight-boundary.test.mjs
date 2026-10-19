import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restorePmPreflightSource, verifyPmPreflightContract } from "./pm-preflight-boundary.mjs";
import { restoreUnifiedArbitrageSource } from "./unified-arb-boundaries.mjs";

const readBeforeExecution = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const gateway = "client/web/src/stores/account/betGateway.ts";
const fok = "packages/venue-adapter/polymarket/fok/bet.ts";
const common = "packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight.ts";
const legs = "client/web/src/stores/betting/autoBet/phases/checkArbLegs.ts";
const picker = "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts";
const retry = "client/web/src/stores/betting/autoBet/retryFailedLeg.ts";

describe("reviewed PM preflight increments retain FOK baseline protection", () => {
  it("requires all fifteen authorized modules and no other changes", () => {
    expect(verifyPmPreflightContract(read)).toEqual({ precisePmPreflightModules: 15, pinnedPmPreflightHelpers: 2 });
  });
  it.each(["pmGammaCache", "pmSportPrewarm"])("protects the complete new %s dependency", name => {
    const helper = `packages/venue-adapter/polymarket/markets/${name}.ts`;
    expect(() => verifyPmPreflightContract(file => read(file) + (file === helper ? "\nvoid unexpectedTradingAction();" : "")))
      .toThrow(/complete reviewed PM preflight helper|original implementation unchanged outside optimized increments/);
  });
  it.each([
    [gateway, 'checkGtcBuy(account, option, undefined,', 'checkGtcBuy(account, option, ensureSharedVaultKeyForAccount(account),'],
    [gateway, 'if (!account || account.provider === "Polymarket")', 'if (!account)'],
    [gateway, 'if (pm) getRetainedPmPrivateKey(account.accountId);', ''],
    [gateway, '...(opts?.requireClobConfirmation ? { requireClobConfirmation: true } : {})', ''],
    [fok, 'if (sportBlock) return sportBlock;', ''],
    [common, 'if (tasks.sportMode !== "legacy") assertPmPreflightSportAllowed(option);', ''],
    [fok, 'if (sportBlock) throw new Error(sportBlock);', ''],
    [common, 'resolvePolymarketBetBlockReason(option, tasks.requireClobConfirmation)', 'resolvePolymarketBetBlockReason(option)'],
    [common, '? await preparePolymarketOrderClientRuntime(input) : getPolymarketOrderClientRuntime(input)', ': await preparePolymarketOrderClientRuntime(input)'],
    [legs, '...(legA.type === "Polymarket" ? { requireClobConfirmation: true } : {}),', ''],
    [legs, '...(legB.type === "Polymarket" ? { requireClobConfirmation: true } : {}),', ''],
    [retry, 'pickedAccount.provider === "Polymarket" ? { requireClobConfirmation: true } : undefined', 'undefined'],
    [picker, 'prewarmPmSportForCandidate(leg);', ''],
  ])("rejects removing/reverting %s: %s", (file, before, after) => {
    expect(read(file)).toContain(before);
    expect(() => verifyPmPreflightContract(target => target === file ? read(file).replace(before, after) : read(target))).toThrow();
  });
  it("cannot silently accept deleting the complete new boundary", () => {
    const reverted = restorePmPreflightSource(gateway, read(gateway), true);
    expect(() => verifyPmPreflightContract(file => file === gateway ? reverted : read(file))).toThrow();
  });
  it.each([
    ["client/web/src/runtime/appSession.ts", "if (!isAuthSessionCurrent(sessionVersion)) return;"],
    ["client/web/src/runtime/sportsSession.ts", "if (gen !== sportsSessionGen) return;"],
  ])("rejects removing the post-wallet cancellation guard in %s", (file, guard) => {
    const before = "  await preparePolymarketAccountRuntimes(accountStore.accounts);\n";
    const after = before + "  " + guard + "\n";
    expect(read(file)).toContain(after);
    expect(() => verifyPmPreflightContract(target => target === file ? read(file).replace(after, before) : read(target))).toThrow();
  });
  it("still rejects unrelated FOK stake mutations after restoration", () => {
    const original = read(fok);
    expect(original).toContain('apiBetMoney,');
    const mutated = original.replace('apiBetMoney,', 'apiBetMoney: 999,');
    expect(() => verifyProtectedSource("packages/venue-adapter/polymarket/bet.ts", read("packages/venue-adapter/polymarket/bet.ts"), gitSource("219535c8", "packages/venue-adapter/polymarket/bet.ts"), file => file === fok ? mutated : read(file))).toThrow();
  });
  it.each([gateway, picker, legs])("composes with the existing GTC dispatch/history boundaries: %s", file => {
    const restored = restoreUnifiedArbitrageSource(file, read(file), replaceExact, true);
    expect(moduleTokens(restored)).toEqual(moduleTokens(gitSource("e901bb596952256284cd8a9eb8b73b572c963915", file)));
  });
});
