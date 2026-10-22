import fs from "node:fs";
import { expect, it } from "vitest";
import { makeupPrecheckExtraction as entry, restoreMakeupPrecheckSource } from "./makeup-precheck-boundary.mjs";
import { loseOrderExecutionExtraction, restoreLoseOrderExecutionSource } from "./lose-order-execution-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("moves the complete existing gate with only continue converted to a false return", () => {
  const source = read(entry.helperFile);
  const body = source.slice(source.indexOf("  if (useBand"), source.indexOf("  return true;"));
  const previous = entry.changes[1][1].trimEnd().split("\n").map(line => line.slice(4)).join("\n")
    .replace("      continue;", "      return false;");
  expect(body).toBe(previous + "\n");
});

it("restores the prior worker and transitively the original immutable consumer", () => {
  const restored = restoreMakeupPrecheckSource(entry.file, read(entry.file), read);
  expect(restoreMakeupPrecheckSource(entry.file, restored, read)).toBe(restored);
  expect(restoreLoseOrderExecutionSource(loseOrderExecutionExtraction.file, read(loseOrderExecutionExtraction.file), read))
    .toBe(gitSource(loseOrderExecutionExtraction.baseline, loseOrderExecutionExtraction.file));
});

it.each([
  source => source.replace("Number(checked.odds) || sideOdds", "Number(checked.newOdds) || sideOdds"),
  source => source.replace("checked.betMoney,", "order.betMoney,"),
  source => source.replace("if (!rateCheck?.allowed)", "if (rateCheck && !rateCheck.allowed)"),
  source => source.replace("useBand && bandPrefs", "bandPrefs"),
])("rejects changed checked odds, stake, invalid-data or bypass behavior", (alter) => {
  const source = read(entry.helperFile);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreMakeupPrecheckSource(entry.file, read(entry.file),
    file => file === entry.helperFile ? alter(source) : read(file))).toThrow(/makeup precheck gate/);
});

it.each([
  source => source.replace("if (!checked.data)", "if (false)"),
  source => source.replace("{ order, checked, account, sideOdds, useBand, bandPrefs }", "{ order, checked: option, account, sideOdds, useBand, bandPrefs }"),
  source => source.replace("      const waitSec =", "      void unexpectedSubmission();\n      const waitSec ="),
])("rejects changed successful-precheck guard, gate inputs and submission order", (alter) => {
  const source = read(entry.file);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreMakeupPrecheckSource(entry.file, alter(source), read)).toThrow();
});
