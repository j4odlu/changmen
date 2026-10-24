import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PM_OFFICIAL_ORDER_PRICE, restorePmOfficialOrderPriceSource, verifyPmOfficialOrderPriceSources } from "./pm-official-order-price.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
it.each(PM_OFFICIAL_ORDER_PRICE.files)("restores the previous $file and rejects unrelated changes", row => {
  const before = execFileSync("git", ["show", `${PM_OFFICIAL_ORDER_PRICE.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(restorePmOfficialOrderPriceSource(row.file, read(row.file))).toBe(before);
  expect(restorePmOfficialOrderPriceSource(row.file, read(row.file).replaceAll("\n", "\r\n"))).toBe(before);
  const changed = `${read(row.file)}\nvoid unexpectedOrderWork();\n`;
  expect(restorePmOfficialOrderPriceSource(row.file, changed)).toBe(changed);
  expect(() => verifyPmOfficialOrderPriceSources(file => file === row.file ? changed : read(file)))
    .toThrow("unregistered official order price change");
});
it("verifies all registered source changes", () => expect(() => verifyPmOfficialOrderPriceSources()).not.toThrow());
