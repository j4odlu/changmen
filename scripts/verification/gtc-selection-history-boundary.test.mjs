import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { restoreGtcSelectionHistorySource } from "./gtc-selection-history-boundary.mjs";
import { restoreUnifiedArbitrageSource } from "./unified-arb-boundaries.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const picker = "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts";
const execution = "client/web/src/orderModes/gtc/arbLeg.ts";
describe("GTC history move keeps the original FOK boundary", () => {
  it.each([picker, execution])("restores only the authorized changes in %s", file => {
    let restored = restoreGtcSelectionHistorySource(file, restorePmPreflightSource(file, read(file)), replaceExact, true);
    // [changmen 扩展] 历史前移与 RAY 公共接线独立；精确还原后仍对照原固定版本。
    if (file === execution) {
      restored = replaceExact(restored, 'import { resolveArbBindOrderId } from "@/stores/betting/arbOrderBind";', "");
      restored = replaceExact(restored, 'registerRejectMonitor: otherAccount.provider === "RAY"', 'registerRejectMonitor: false');
      restored = replaceExact(restored,
        'const original = otherAccount.provider === "RAY" ? outcome.orders.find(order => order.orderId === resolveArbBindOrderId(outcome.orders, result, outcome.rejected)) : findGtcOtherOrder(current(), outcome.orders);',
        'const original = findGtcOtherOrder(current(), outcome.orders);');
    }
    expect(moduleTokens(restored))
      .toEqual(moduleTokens(gitSource("2ab5e37f", file)));
  });
  it.each([
    ["GTC-only activation", 'if (pmOrderMode === "GTC")', "if (true)"],
    ["history filter", "(!gtcHistoryFilter || gtcHistoryFilter(acc, legA))", "true"],
    ["original FOK filter", "arbAccountPickerFilter(acc, bet, match, legA, matchStore, implied)", "true"],
    ["recovery gate", "if (historyStatus)", "if (false)"],
  ])("rejects changing %s", (_name, before, after) => {
    const source = read(picker); expect(source).toContain(before);
    expect(() => restoreUnifiedArbitrageSource(picker, source.replace(before, after), replaceExact, true)).toThrow();
  });
  it.each([
    ["late recheck", "checkSession(); validateHistory();\n      pairStarted = true", "checkSession();\n      pairStarted = true"],
    ["second-leg continuity", "if (pairStarted) return;", "if (false) return;"],
  ])("rejects changing %s", (_name, before, after) => {
    const source = read(execution).replace(/\r\n/g, "\n"); expect(source).toContain(before);
    expect(() => restoreGtcSelectionHistorySource(execution, source.replace(before, after), replaceExact, true)).toThrow();
  });
});
