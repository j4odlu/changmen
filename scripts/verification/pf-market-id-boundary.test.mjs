import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { restorePfMarketIdSource, verifyPfMarketIdSource } from "./pf-market-id-boundary.mjs";
import { withAdapterHistoryReader } from "./browser-entry-history.mjs";

const file = "client/packages/venue-browser/adapter/predictfun/bet.ts";
const read = name => fs.readFileSync(name, "utf8");
const current = read(file);

test("PF marketId repair restores the complete original source without changing its baseline", () => {
  const baseline = execFileSync("git", ["show", `b9b0a6ee13cf83384576253b4fe65080a47231fa:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(verifyPfMarketIdSource(read)).toEqual({ files: 1 });
  expect(restorePfMarketIdSource(file, current)).toBe(baseline);
  expect(restorePfMarketIdSource(file, baseline)).toBe(baseline);
  expect(withAdapterHistoryReader(read)(file)).toBe(baseline);
});

test.each([
  source => `${source}\nvoid unexpectedTradingAction();\n`,
  source => source.replace("[fromData?.marketId, fromItem, cached, fromIndex]", "[fromIndex, cached, fromItem, fromData?.marketId]"),
  source => source.replace("const PRECHECK_BOOK_REUSE_MS = 400;", "const PRECHECK_BOOK_REUSE_MS = 4000;"),
])("unreviewed PF changes cannot use the historical repair proof", mutate => {
  const altered = mutate(current);
  expect(altered).not.toBe(current);
  expect(restorePfMarketIdSource(file, altered)).toBe(altered);
  expect(() => verifyPfMarketIdSource(name => name === file ? altered : read(name))).toThrow("Only the exact PF marketId");
});

test("the repair does not exempt another venue or shared trading code", () => {
  for (const name of ["client/packages/venue-browser/adapter/polymarket/bet.ts", "client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts"])
    expect(restorePfMarketIdSource(name, current)).toBe(current);
});
