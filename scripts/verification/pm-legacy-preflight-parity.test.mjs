import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens } from "./fok-exact-boundaries.mjs";
import { restorePmOptimizedFokSource } from "./pm-optimized-fok-boundary.mjs";

const root = "packages/venue-adapter/polymarket/";
const baseline = "1632d6905061f56fcc7af7039914ca26d743ed48";
const printer = ts.createPrinter({ removeComments: true });
function functions(source) {
  const file = ts.createSourceFile("pm.ts", source, ts.ScriptTarget.Latest, true);
  const result = new Map();
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body)
      result.set(node.name.getText(file), printer.printNode(ts.EmitHint.Unspecified, node.body, file));
    ts.forEachChild(node, visit);
  }
  visit(file); return result;
}
const online = functions(gitSource(baseline, root + "fok/bet.ts"));
const current = functions(["fok/preflight.ts", "fok/bet.ts"].map(file =>
  restorePmOptimizedFokSource(root + file, fs.readFileSync(root + file, "utf8"), true)).join("\n"));
function replaceOne(text, before, after = "") {
  expect(text.split(before)).toHaveLength(2);
  return text.replace(before, after);
}

describe("legacy FOK compared directly to the deployed version", () => {
  for (const [name, body] of online) {
    if (["checkBet", "betting", "validatePolymarketPreparedBuy"].includes(name)) continue;
    it(`${name} retains the complete deployed body`, () => expect(current.get(name)).toBe(body));
  }
  it.each(["betting", "validatePolymarketPreparedBuy"])("%s has exactly the deployed behavior for a captured legacy attempt", name => {
    const body = current.get(name);
    const file = ts.createSourceFile("pm.ts", "function check() " + body, ts.ScriptTarget.Latest, true);
    const ranges = [];
    function visit(node) {
      if (ts.isIfStatement(node) && /prepared\??\.preflightMode === "optimized"/.test(node.expression.getText(file))) {
        expect(node.elseStatement).toBeUndefined();
        expect(moduleTokens(node.thenStatement.getText(file))).toEqual(moduleTokens(name === "betting"
          ? '{ const sportBlock = getPolymarketPmSportBlockReasonFromOption(option); if (sportBlock) throw new Error(sportBlock); }'
          : '{ const sportBlock = getPolymarketPmSportBlockReasonFromOption(option); if (sportBlock) return sportBlock; }'));
        ranges.push([node.getStart(file), node.getEnd()]);
      }
      ts.forEachChild(node, visit);
    }
    visit(file); expect(ranges).toHaveLength(1);
    let text = file.text;
    for (const [start, end] of ranges.reverse()) text = text.slice(0, start) + text.slice(end);
    expect(functions(text).get("check")).toBe(online.get(name));
  });
  it("preflight retains the full online FOK algorithm around the explicitly extracted common tasks", () => {
    let body = current.get("checkFokBuy");
    body = replaceOne(body, '    const preflightMode = capturePmFokPreflightMode(option);\n');
    const common = `        const { market: buySettled, guard: guardSettled, runtime: runtimeSettled, clock: clockSettled } = await runPmBuyPreflight(account, option, {
            sportMode: preflightMode,
            gateway,
            market: () => resolvePolymarketExecutableBuy(gateway, tokenId, detectionOdds, apiBetMoney, maxPrice),
            role: context?.role,
            requireClobConfirmation: context?.requireClobConfirmation,
            runtimeBinding: () => preparationBinding(account, option),
            missingCredentialsMessage: "PM 钱包或 API 凭据未就绪，请解锁钱包并检查账号",
            measureStages: true,
        });`;
    const original = online.get("checkBet");
    const start = original.indexOf("        const buyP =");
    const end = original.indexOf('        if (guardSettled.status === "fulfilled"', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    body = replaceOne(body, common + "\n", original.slice(start, end));
    body = replaceOne(body, '        if (runtimeSettled.value && (!matchesPmPreflightBinding(runtimeSettled.value, () => preparationBinding(account, option))))',
      '        if (runtimeSettled.value && (runtimeSettled.value.binding !== preparationBinding(account, option)\n            || runtimeSettled.value.generation !== polymarketSigningGeneration()))');
    body = replaceOne(body, '            pmPreflightMode: preflightMode,\n');
    body = replaceOne(body, 'preparedBuys.set(option, { preflightMode, data:', 'preparedBuys.set(option, { data:');
    expect(body).toBe(original);
  });
  it.each([
    "markets/pmSportGuard.ts", "markets/pmMarketGuard.ts", "submission/preflight/pmDetection.ts",
    "submission/preflight/pmMarketOrderOptions.ts", "quotes/pmTickPrice.ts",
  ])("%s keeps its online predicates", file => {
    expect(moduleTokens(fs.readFileSync(root + file, "utf8"))).toEqual(moduleTokens(gitSource(baseline, root + file)));
  });
});
