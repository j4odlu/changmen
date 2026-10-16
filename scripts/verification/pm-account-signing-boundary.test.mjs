import fs from "node:fs";
import { expect, test } from "vitest";
import { restorePmAccountSigningSource, verifyPmAccountSigningContract } from "./pm-account-signing-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8");
const { changes } = JSON.parse(read("scripts/verification/pm-account-signing-increments.json"));

test("account isolation preserves all behavior outside its explicit increments", () => {
  expect(() => verifyPmAccountSigningContract(read)).not.toThrow();
});

test.each(Object.keys(changes))("rejects deleted isolation or unrelated changes in %s", file => {
  expect(() => verifyPmAccountSigningContract(target => target === file
    ? restorePmAccountSigningSource(file, read(file), true) : read(target))).toThrow();
  expect(() => verifyPmAccountSigningContract(target => read(target)
    + (target === file ? "\nvoid unexpectedSubmit();" : ""))).toThrow();
});
