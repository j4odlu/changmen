import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, manualBaselineAfterKnownCorrection, moduleTokens, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { checkOrdinaryOrderList } from "./fok-order-list-boundary.mjs";

const core = "219535c8";
const vps = "75b1efac66625e5f2bc9884a965b244bfaf337ed";
const root = "client/web/src/stores/betting/autoBet/";
const files = [`${root}phases/checkArbLegs.ts`, `${root}phases/placeArbLegs.ts`, `${root}executeArbBet.ts`, "client/web/src/stores/betting/activeBetRunSync.ts", "server/backend/core/account/order/position_events.js", "client/web/src/stores/account/betGateway.ts", "client/web/src/components/order/OrderView.vue"];
const read = file => fs.readFileSync(file, "utf8");
function check(file, source = read(file), readSource = read, base = vps) {
  return verifyProtectedSource(file, source, gitSource(base, file), readSource, target => gitSource(base, target));
}
function mutate(file, before, after, base = vps) {
  const source = read(file);
  assert(source.includes(before), `negative test mutation must apply: ${before}`);
  expect(() => check(file, source.replace(before, after), read, base)).toThrow();
}
describe("precise whole-module release protection", () => {
  for (const file of files) {
    for (const base of [core, vps]) {
      it(`${file}/${base}: verifies exact existing additions against original complete source`, () => {
        expect(check(file, undefined, undefined, base).exactBoundaryVerified).toBe(true);
      });
      it(`${file}/${base}: rejects an extra module action`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedTradingAction();\n`, read, base)).toThrow();
      });
    }
  }
  it("does not normalize whitespace inside literal business payloads", () => {
    expect(moduleTokens("post(\"a b\");")).not.toEqual(moduleTokens("post(\"a  b\");"));
    expect(moduleTokens("post(`a b`);")).not.toEqual(moduleTokens("post(`a  b`);"));
  });
  it("rejects unknown paths rather than accepting matching extension names", () => {
    expect(() => verifyProtectedSource("unknown.ts", "observeArbSubmissionBlocked();", "")).toThrow("unregistered");
  });
});

describe("A8 makeup tail correction preserves the rest of the original round", () => {
  const file = "client/web/src/stores/betting/runArbBetRound.ts";
  for (const base of [core, vps]) {
    it(`accepts only the exact tail correction against ${base}`, () => {
      expect(check(file, undefined, undefined, base)).toMatchObject({
        fixedSourceEqual: false,
        exactBoundaryVerified: true,
        kind: "A8 makeup tail gate correction with complete fixed-baseline module",
      });
    });
    for (const [before, after] of [
      ["if ((user.config.makeUp && loseStore.orders.size) || hasCurrentPendingVenueObservation)", "if (loseStore.orders.size || hasCurrentPendingVenueObservation)"],
      ["const hasCurrentPendingVenueObservation = [...loseStore.orders.values()]", "const hasCurrentPendingVenueObservation = []"],
      ["if (needBetting)", "if (true)"],
      ["await processLoseOrders();", "await processLoseOrders(); await processLoseOrders();"],
    ]) {
      it(`rejects an additional round change ${before}/${base}`, () => mutate(file, before, after, base));
    }
    it(`rejects unrelated actions in the module/${base}`, () => {
      expect(() => check(file, `${read(file)}\nvoid unexpectedTradingAction();\n`, read, base)).toThrow();
    });
  }
});

describe("shared account gateway keeps exact mode and auxiliary-failure boundaries", () => {
  const file = "client/web/src/stores/account/betGateway.ts";
  for (const [before, after] of [
    ["opts?.pmOrderMode === \"GTC\"", "true"],
    ["opts?.pmGtcAllowResting !== true", "false"],
    ["try { result.saveLog(account, beginTime); }", "try { result.saveLog(account, beginTime); void unexpectedTradingAction(); }"],
    ["playOrderSuccessSound({ betRowId: option.betId }).catch(() => {})", "playOrderSuccessSound({ betRowId: option.betId }).catch(() => { void unexpectedTradingAction(); })"],
    ["publishBettingEvent(option).catch(() => {})", "publishBettingEvent(option).catch(() => { void unexpectedTradingAction(); })"],
    ["&& !opts?.requirePreparedQuote) await ensureSharedVaultKeyForAccount(account)", ") await ensureSharedVaultKeyForAccount(account)"],
    ["checkedOption = checked;", "checkedOption = option;"],
    ["try { checkedOption.saveLog(account); }", "try { checkedOption.saveLog(account); void unexpectedTradingAction(); }"],
    ["展示数据读取失败不能阻断已经预检的场馆发送。 */ }", "展示数据读取失败不能阻断已经预检的场馆发送。 */ void unexpectedTradingAction(); }"],
  ]) {
    for (const base of [core, vps]) {
      it(`rejects changed shared gateway boundary ${before}/${base}`, () => mutate(file, before, after, base));
    }
  }
});
describe("execution gates and observation placement", () => {
  it("rejects changed deadline inequality", () => mutate(files[0], "> config.checkTimeout", ">= config.checkTimeout"));
  it("rejects observer moved out of the original timeout gate", () => {
    const file = files[0]; const source = read(file);
    const line = "observeArbSubmissionBlocked({ ...ready, legA, legB }, \"precheck_timeout\", msg);";
    assert(source.includes(line));
    const changed = source.replace(line, "").replace("  if (config.checkTimeout", `  ${line}\n  if (config.checkTimeout`);
    expect(() => check(file, changed)).toThrow();
  });
  it("rejects changed second-leg conditions", () => mutate(files[1], "if (resultA.success)", "if (true)"));
  it("rejects different second-leg POST arguments", () => mutate(files[1], "await submitLeg(accountB!, legB)", "await submitLeg(accountA!, legB)"));
  it("rejects widened pair observation gate", () => mutate(files[1], "if (mixedBlocked)", "if (mixedBlocked || accountA)"));
  it("rejects an observer mutating the original leg", () => {
    const helper = "client/web/src/services/orderExecutionObservation.ts";
    expect(() => check(files[0], undefined, requested => requested === helper
      ? read(requested).replace("const evidence = observationFailureEvidence(message);", "ready.legA.betMoney = 0; const evidence = observationFailureEvidence(message);")
      : read(requested))).toThrow();
  });
  it("rejects an observer propagating its own error", () => {
    const helper = "client/web/src/services/orderExecutionObservation.ts";
    expect(() => check(files[1], undefined, requested => requested === helper
      ? read(requested).replace("catch { /* 观察失败不得改变门控结果 */ }", "catch (error) { throw error; }")
      : read(requested))).toThrow();
  });
  it("rejects removing isolated failure-progress try/catch", () => mutate(files[2], "catch { /* [changmen 扩展] 进度记录失败不得中断 FOK 原有异常收尾。 */ }", "catch (error) { throw error; }"));
  it("rejects changed release/cleanup policy", () => mutate(files[2], "stop: \"error\"", "stop: \"success\""));
  it("rejects changed optional failure stage", () => mutate(files[3], "layer ?? (", "\"拒单\" ?? ("));
  it("rejects widened historical GTC cash gate", () => mutate(files[4], "raw.pmGtcExecutionId &&", "(raw.pmGtcExecutionId || row.provider === 'Polymarket') &&"));
  it("rejects changed ordinary historical cash", () => mutate(files[4], ": raw.pmStakeUsdc", ": row.bet_money"));
});
describe("notification wrappers cannot hide trading or confirmation changes", () => {
  const file = files[5];
  for (const [name, before, after] of [
    ["wrong POST arguments", "provider.betting(account, option)", "provider.betting(account, { ...option, betMoney: 0 })"],
    ["a second POST", "result = await provider.betting(account, option);", "result = await provider.betting(account, option); await provider.betting(account, option);"],
    ["different reject eligibility", "!result.pmSubmitUnknown", "true"],
    ["changed confirmation gate", "&& !option.loseOrder", "&& true"],
    ["changed deferred confirmation gate", "&& !option.deferPostAcceptSettlement", "&& true"],
    ["premature pending count", "if (!rejected && !task.recoveryOnly)", "if (true)"],
    ["different pending retry delay", "1_000 * 2 **", "1 * 2 **"],
    ["different request duration", "}, toastSeconds);", "}, 1);"],
    ["result wrapper replaced by arbitrary helper", "showBetResultNotification(notificationDisplay", "skipNotification(notificationDisplay"],
  ]) it(`rejects ${name}`, () => mutate(file, before, after));
  for (const [name, before, after] of [
    ["loading failure propagation", "catch { return { close: () => {} }; }", "catch (error) { throw error; }"],
    ["close failure propagation", "catch { /* 提示清理异常不影响下单 */ }", "catch (error) { throw error; }"],
    ["result failure propagation", "catch { /* 提示异常不能改变下单结果 */ }", "catch (error) { throw error; }"],
    ["helper side effects", "loading.close();", "loading.close(); void fetch('/new-query');"],
  ]) {
    it(`rejects ${name} in the complete helper`, () => {
      const helper = "client/web/src/shared/betNotification.ts";
      assert(read(helper).includes(before));
      expect(() => check(file, undefined, requested => requested === helper ? read(requested).replace(before, after) : read(requested))).toThrow();
    });
  }
});
describe("shared OrderList preserves all ordinary behavior", () => {
  const file = "client/web/src/components/order/OrderList.vue";
  const baseline = gitSource(core, file);
  it("checks the entire Vue file with the exact DisplayOnly guards", () => expect(checkOrdinaryOrderList(read(file), baseline).completeOrdinaryModuleEqual).toBe(true));
  for (const [name, before, after] of [
    ["wider sell guard", "!row.DisplayOnly", "!row.DisplayOnly && row.Type !== 'RAY'"],
    ["wider PnL guard", "row.DisplayOnly && row.BetMoney == null", "row.DisplayOnly || row.BetMoney == null"],
    ["different amount fallback", "toFixed(pmOrderStakeDisplayCny(block.row), 0)", "toFixed(pmOrderStakeDisplayCny(block.row), 1)"],
    ["different optional detail gate", "block.row.PmGtcExecutionId &&", "block.row.Type === 'Polymarket' &&"],
    ["different ordinary sell rule", "canManualSellPmBuy(row);", "canManualSellPmBuy({ ...row, BetMoney: 0 });"],
  ]) {
    it(`rejects ${name}`, () => {
      assert(read(file).includes(before));
      expect(() => checkOrdinaryOrderList(read(file).replace(before, after), baseline)).toThrow();
    });
  }
});
describe("independent manual correction remains exact and traceable to the original baseline", () => {
  const file = "client/web/src/stores/betting/manualBet.ts";
  it("only removes the four known original gates and their unused local variables", () => {
    const restored = manualBaselineAfterKnownCorrection(gitSource(core, file));
    expect(restored).toContain("skipAccountRate: true");
    expect(restored).toContain("markSuccessfulBet(account, bet.id, side, option.odds)");
  });
  it("rejects an altered legacy gate instead of blindly removing it", () => {
    expect(() => manualBaselineAfterKnownCorrection(gitSource(core, file).replace("bal < amount", "bal <= amount"))).toThrow();
  });
});
