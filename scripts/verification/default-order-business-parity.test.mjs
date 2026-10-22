// [changmen 扩展] 线上后端已捕获并核实为此 commit；直接对照完整 provider 记账函数。
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as currency from "@changmen/shared/currency";
import * as submission from "@changmen/shared/pm_submission";
import { normalizePmMatchResult, parseNum } from "../../server/backend/core/account/order/dto.js";
import { preparePmPendingOrderSave } from "../../server/backend/core/account/order/pm_pending.js";

const onlineBackend = "ed4a158c854d5b28093a76727a6c08081233af14";
const file = "server/backend/core/account/order/save_pm.js";
function load(old) {
  const source = old ? execFileSync("git", ["show", `${onlineBackend}:${file}`], { encoding: "utf8" }) : fs.readFileSync(file, "utf8");
  const exports = {};
  const context = vm.createContext({ exports, require: name => name.endsWith("/currency") ? currency
    : name.endsWith("/pm_submission") ? submission : { normalizePmMatchResult, parseNum } });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return exports.mergePolymarketProviderSave;
}
const previousMerge = load(true), currentMerge = load(false);
const snapshot = { orderId: "same", accountId: 292, makerAmount: "100000000", takerAmount: "200000000", stakeUsdc: 100, submittedAt: 1700000000000 };
const filled = { provider: "Polymarket", order_id: "same", status: "None", bet_money: 670, money: 0,
  raw: { provider: "Polymarket", orderId: "same", status: "none", betMoney: 670, money: 0,
    pmSubmission: snapshot, pmOrigin: "changmen", pmSide: "buy", pmStakeUsdc: 100, pmShares: 200, pmFillPrice: .5 } };
function merge(fn, prev, order, current = false) {
  const incoming = current ? preparePmPendingOrderSave(prev, structuredClone(order), 292, "Polymarket") : structuredClone(order);
  if (!incoming) return null;
  const raw = prev?.raw || {};
  const result = fn(prev, raw, incoming, incoming.pmOrigin || raw.pmOrigin, { ...incoming }, Number(incoming.money) || 0, Number(incoming.betMoney) || 0);
  return JSON.parse(JSON.stringify(result));
}
const financial = result => result && ({ money: result.money, bet_money: result.bet_money,
  ...Object.fromEntries(["pmSide", "pmStakeUsdc", "pmShares", "pmFillPrice", "pmFeeUsdc", "pmAttributedSellShares", "pmSellState", "pmSellProceeds", "pmMatchResult"]
    .map(key => [key, result.raw[key]])) });

describe("ordinary PM financial behavior versus the captured live backend", () => {
  it.each(["none", "win", "lose", "reject", "return"])("fresh %s order keeps its existing accounting", status => {
    const incoming = { ...filled.raw, status, ...(status === "win" ? { money: 670 } : status === "lose" ? { money: -670 } : {}) };
    expect(financial(merge(currentMerge, undefined, incoming, true))).toEqual(financial(merge(previousMerge, undefined, incoming)));
  });
  it.each(["none", "win", "lose"])("confirmed buy synchronizing %s retains cost, shares and fees", status => {
    const incoming = { provider: "Polymarket", orderId: "same", status, betMoney: 672, money: 0,
      pmStakeUsdc: 100.3, pmShares: 200, pmFillPrice: .5, pmFeeUsdc: .3 };
    expect(financial(merge(currentMerge, filled, incoming, true))).toEqual(financial(merge(previousMerge, filled, incoming)));
  });
  it.each(["partial", "closed", "settled"])("existing %s sell progress keeps its existing accounting", state => {
    const prev = { ...filled, raw: { ...filled.raw, pmSellState: state, pmAttributedSellShares: 100, pmSellProceeds: 70, money: 134 } };
    const incoming = { provider: "Polymarket", orderId: "same", status: "none", betMoney: 600, money: 0,
      pmStakeUsdc: 50, pmShares: 200, pmSellState: "settled", pmAttributedSellShares: 100, pmSellProceeds: 70 };
    expect(financial(merge(currentMerge, prev, incoming, true))).toEqual(financial(merge(previousMerge, prev, incoming)));
  });
  it("sell rows keep realized PnL on the buy instead of changing the existing rule", () => {
    const incoming = { provider: "Polymarket", orderId: "sell", pmSide: "sell", pmOrigin: "changmen",
      betMoney: 402, money: 10, pmBuyOrderId: "same", pmShares: 100, pmStakeUsdc: 60, pmRealizedPnlUsdc: 10 };
    expect(financial(merge(currentMerge, undefined, incoming, true))).toEqual(financial(merge(previousMerge, undefined, incoming)));
  });
  it("explicitly records the authorized difference: late zero-fee fill replaces the rejection's requested amount", () => {
    const prev = { ...filled, status: "Reject", raw: { ...filled.raw, status: "reject", pmShares: undefined } };
    const incoming = { provider: "Polymarket", orderId: "same", status: "none", betMoney: 660,
      pmShares: 200, pmStakeUsdc: 660 / 6.7, pmFillPrice: .49, pmFeeUsdc: 0, money: 0 };
    expect(merge(previousMerge, prev, incoming).bet_money).toBe(670);
    expect(merge(currentMerge, prev, incoming, true).bet_money).toBe(660);
  });
  it("explicitly records the authorized difference: a stale rejection cannot replace confirmed fill evidence", () => {
    const incoming = { provider: "Polymarket", orderId: "same", status: "reject", betMoney: 670, money: 0 };
    expect(merge(previousMerge, filled, incoming)).not.toBeNull();
    expect(merge(currentMerge, filled, incoming, true)).toBeNull();
  });
});
