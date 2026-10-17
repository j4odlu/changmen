// [changmen 扩展] Restore only the two UI attachment lines; all historical FOK hashes remain fixed.
import assert from "node:assert/strict";
export const PM_BOOK_SETTINGS_TAB = "client/web/src/components/user/tabs/UserDiagExtensionsTab.vue";
const additions = ['import PmBookSettings from "./PmBookSettings.vue";\n', '      <PmBookSettings />\n'];
export function restorePmBookSettingsSource(file, source, required = false) {
  if (file !== PM_BOOK_SETTINGS_TAB) return source;
  let result = source.replaceAll("\r\n", "\n");
  if (!required && !result.includes("PmBookSettings")) return source;
  for (const addition of additions) {
    assert.equal(result.split(addition).length, 2, "unique, exact local book settings UI attachment");
    result = result.replace(addition, "");
  }
  return result;
}
