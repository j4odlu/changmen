import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PM_SUBMITTED_ODDS_DISPLAY_FILE as file, restorePmSubmittedOddsDisplaySource } from "./pm-submitted-odds-display.mjs";
import { verifyPendingOrderDisplaySources } from "./pm-pending-order-display-boundary.mjs";
import { PM_ORDER_ODDS_PAIR, restorePmOrderOddsPairSource } from "./pm-order-odds-pair.mjs";

const read = target => fs.readFileSync(target, "utf8").replaceAll("\r\n", "\n");

it.each(PM_ORDER_ODDS_PAIR.files)("restores $file before the exact odds pair UI change", row => {
  const before = execFileSync("git", ["show", `${PM_ORDER_ODDS_PAIR.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(restorePmOrderOddsPairSource(row.file, read(row.file))).toBe(before);
  expect(restorePmOrderOddsPairSource(row.file, read(row.file).replaceAll("\n", "\r\n"))).toBe(before);
  const mutation = `${read(row.file)}\nvoid extraOrderWork();\n`;
  expect(restorePmOrderOddsPairSource(row.file, mutation)).toBe(mutation);
  expect(() => verifyPendingOrderDisplaySources(target => target === row.file ? mutation : read(target)))
    .toThrow("unregistered original-order display change");
});

it("restores the complete pre-correction source without replacing the historical baseline", () => {
  const before = execFileSync("git", ["show", `a5aed8a4:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(restorePmSubmittedOddsDisplaySource(file, read(file))).toBe(before);
  expect(restorePmSubmittedOddsDisplaySource(file, read(file).replaceAll("\n", "\r\n"))).toBe(before);
});

it("rejects extra code and changed FOK/GTC guards outside the registered correction", () => {
  for (const mutation of [
    `${read(file)}\nvoid unexpectedOrderWork();\n`,
    read(file).replace("&& !row.PmGtcExecutionId", "&& row.PmGtcExecutionId"),
  ]) {
    expect(restorePmSubmittedOddsDisplaySource(file, mutation)).toBe(mutation);
    expect(() => verifyPendingOrderDisplaySources(target => target === file ? mutation : read(target)))
      .toThrow("unregistered original-order display change");
  }
});
