import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, it } from "vitest";
import { ACCOUNT_EDIT_EXTRACTION as evidence, restoreAccountEditSource, verifyAccountEditExtraction } from "./account-edit-extraction.mjs";
const read = file => fs.readFileSync(file, "utf8");
const normalize = source => source.replaceAll("\r\n", "\n");

it("restores the complete original dialog while independently authenticating all six extracted modules", () => {
  expect(verifyAccountEditExtraction(read)).toEqual({ files: 1, assets: 6 });
  const original = execFileSync("git", ["show", `${evidence.baseline}:${evidence.file}`], { encoding: "utf8", windowsHide: true });
  for (const source of [read(evidence.file), normalize(read(evidence.file)).replaceAll("\n", "\r\n")])
    expect(restoreAccountEditSource(evidence.file, source)).toBe(normalize(original));
});

it("does not restore over an extra change to the component, and rejects altered wallet/save modules", () => {
  const changed = read(evidence.file).replace("polyAdvancedMode.value)", "!polyAdvancedMode.value)");
  expect(changed).not.toBe(read(evidence.file));
  expect(restoreAccountEditSource(evidence.file, changed)).toBe(changed);
  expect(() => verifyAccountEditExtraction(file => file === evidence.file ? changed : read(file))).toThrow("Unreviewed account dialog extraction");
  for (const row of evidence.assets)
    expect(() => verifyAccountEditExtraction(file => read(file) + (file === row.file ? "\nvoid unreviewed();" : "")))
      .toThrow("extracted account implementation changed");
});
