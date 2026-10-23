import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, it } from "vitest";
import { FRONTEND_DEPENDENCY_REFACTOR as evidence, restoreFrontendDependencySource, verifyFrontendDependencyRefactor } from "./frontend-dependency-refactor.mjs";

const read = file => fs.readFileSync(file, "utf8");
const normalize = source => source.replaceAll("\r\n", "\n");
const original = file => execFileSync("git", ["show", `${evidence.baseline}:${file}`], { encoding: "utf8", windowsHide: true });

it("restores every complete pre-refactor file to the original Git source without changing existing baselines", () => {
  expect(verifyFrontendDependencyRefactor(read)).toEqual({ files: 27, assets: 7 });
  for (const row of evidence.files) {
    const source = read(row.file);
    for (const current of [source, normalize(source).replaceAll("\n", "\r\n")])
      expect(restoreFrontendDependencySource(row.file, current), row.file).toBe(normalize(original(row.file)));
  }
});

it("preserves the extracted EV configuration and account funding formatter exactly", () => {
  expect(normalize(read("client/web/src/config/valueBet.ts"))).toBe(normalize(original("client/web/src/extensions/valueBet/evConfig.ts")));
  const source = normalize(original("client/web/src/stores/account/accountPicker.ts"));
  const start = source.indexOf("export function formatAccountFundingHint(");
  const end = source.indexOf("export function getProviders", start);
  expect(normalize(read("client/web/src/domain/betting/accountFundingHint.ts"))).toBe(
    'import type { PlatformAccount } from "@/models/platformAccount";\n\n' + source.slice(start, end).trimEnd() + '\n');
});

it("rejects an extra change to quote matching or preference defaults instead of restoring over it", () => {
  for (const [file, before, after] of [
    ["client/web/src/domain/polymarket/tickBufferQuote.ts", "result.quote.displayOdds !== option.odds", "result.quote.displayOdds < option.odds"],
    ["client/web/src/types/extensionPrefs.ts", "singleLeg9999HigherCProbabilityOnly: false", "singleLeg9999HigherCProbabilityOnly: true"],
  ]) {
    const changed = read(file).replace(before, after);
    expect(changed).not.toBe(read(file));
    expect(restoreFrontendDependencySource(file, changed)).toBe(changed);
    expect(() => verifyFrontendDependencyRefactor(current => current === file ? changed : read(current))).toThrow(/unreviewed dependency repair/);
  }
});

it("rejects changes to extracted defaults or the Pinia adapter", () => {
  for (const file of ["client/web/src/config/valueBet.ts", "client/web/src/services/quoteSource.ts"])
    expect(() => verifyFrontendDependencyRefactor(current => read(current) + (current === file ? "\nchanged" : ""))).toThrow(/extracted implementation changed/);
});
