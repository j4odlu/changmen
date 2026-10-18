import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { PM_BOOK_SETTINGS_TAB, restorePmBookSettingsSource } from "./pm-book-settings-boundary.mjs";
import { verifyPmUnifiedPreflightContract } from "./pm-unified-preflight-boundary.mjs";
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
test("UI attachment restores to all original immutable preflight contracts", () => {
  verifyPmUnifiedPreflightContract(read);
});
test("missing, duplicate or altered attachment cannot be exempted", () => {
  const source = read(PM_BOOK_SETTINGS_TAB);
  for (const changed of [source.replace("<PmBookSettings />", ""),
    source.replace("<PmBookSettings />", "<PmBookSettings :enabled=\"true\" />"),
    source + '\n      <PmBookSettings />\n']) {
    assert.throws(() => restorePmBookSettingsSource(PM_BOOK_SETTINGS_TAB, changed, true));
  }
});
test("changes to defaults or unreviewed display text still fail the original source hash", () => {
  assert.throws(() => verifyPmUnifiedPreflightContract(file => file === PM_BOOK_SETTINGS_TAB
    ? read(file).replace('pmFokPreflightMode ??= "legacy"', 'pmFokPreflightMode ??= "optimized"') : read(file)));
  assert.throws(() => verifyPmUnifiedPreflightContract(file => file === PM_BOOK_SETTINGS_TAB
    ? read(file).replace('aria-label="预检方式"', 'aria-label="跳过预检"') : read(file)));
});
