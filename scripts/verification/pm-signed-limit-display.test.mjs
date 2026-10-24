import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PM_SIGNED_LIMIT_DISPLAY, restorePmSignedLimitDisplaySource, verifyPmSignedLimitDisplaySources } from "./pm-signed-limit-display.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
it.each(PM_SIGNED_LIMIT_DISPLAY.files)("restores the complete previous $file and rejects unregistered changes", row => {
  const before = execFileSync("git", ["show", `${PM_SIGNED_LIMIT_DISPLAY.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(restorePmSignedLimitDisplaySource(row.file, read(row.file))).toBe(before);
  expect(restorePmSignedLimitDisplaySource(row.file, read(row.file).replaceAll("\n", "\r\n"))).toBe(before);
  const mutation = `${read(row.file)}\nvoid unexpectedOrderWork();\n`;
  expect(restorePmSignedLimitDisplaySource(row.file, mutation)).toBe(mutation);
  expect(() => verifyPmSignedLimitDisplaySources(file => file === row.file ? mutation : read(file)))
    .toThrow("unregistered signed-limit display change");
});
it("validates every current file against its exact increment", () => {
  expect(() => verifyPmSignedLimitDisplaySources()).not.toThrow();
});
