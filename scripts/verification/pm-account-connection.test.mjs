import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PM_ACCOUNT_CONNECTION, restorePmAccountConnectionSource, verifyPmAccountConnectionSources } from "./pm-account-connection.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
it.each(PM_ACCOUNT_CONNECTION.files)("authenticates the exact $file increment and restores its complete previous source", row => {
  const before = execFileSync("git", ["show", `${PM_ACCOUNT_CONNECTION.baseline}:${row.file}`], { encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
  expect(restorePmAccountConnectionSource(row.file, read(row.file))).toBe(before);
  expect(restorePmAccountConnectionSource(row.file, read(row.file).replaceAll("\n", "\r\n"))).toBe(before);
  const changed = read(row.file) + "\nvoid unreviewed();\n";
  expect(restorePmAccountConnectionSource(row.file, changed)).toBe(changed);
  expect(() => verifyPmAccountConnectionSources(file => file === row.file ? changed : read(file))).toThrow("unregistered PM connection change");
});
