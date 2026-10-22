import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PENDING_ORDER_DISPLAY_INCREMENTS, restorePendingOrderDisplaySource, verifyPendingOrderDisplaySources } from "./pm-pending-order-display-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
describe("PM Pending single-row lifecycle is registered with exact source hunks", () => {
  it.each(Object.keys(PENDING_ORDER_DISPLAY_INCREMENTS.changes))("retains the entire previous %s outside the exact correction", file => {
    const before = execFileSync("git", ["show", `${PENDING_ORDER_DISPLAY_INCREMENTS.baseline}:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    expect(restorePendingOrderDisplaySource(file, read(file))).toBe(before);
    expect(restorePendingOrderDisplaySource(file, read(file).replaceAll("\n", "\r\n"))).toBe(before);
    const mutation = `${read(file)}\nvoid unregisteredSubmission();\n`;
    expect(restorePendingOrderDisplaySource(file, mutation)).toBe(mutation);
    expect(() => verifyPendingOrderDisplaySources(target => target === file ? mutation : read(target))).toThrow("unregistered original-order display change");
  });
  it("checks the complete order-information helper and does not accept unregistered fields", () => {
    expect(verifyPendingOrderDisplaySources().files).toBe(25);
    const file = "client/web/src/stores/account/pmPendingOrder.ts";
    expect(() => verifyPendingOrderDisplaySources(target => target === file ? `${read(target)}\nexport const amount = 999;\n` : read(target))).toThrow("complete original-order display helper changed");
  });
});
