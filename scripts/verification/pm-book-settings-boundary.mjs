// [changmen 扩展] Restore exact display wording and the two UI attachment lines; historical hashes remain fixed.
import assert from "node:assert/strict";
export const PM_BOOK_SETTINGS_TAB = "client/web/src/components/user/tabs/UserDiagExtensionsTab.vue";
const additions = ['import PmBookSettings from "./PmBookSettings.vue";\n', '      <PmBookSettings />\n'];
const labels = [
  ['<h3 class="extensions-tab__heading">PM FOK 预检方式</h3>', '<h3 class="extensions-tab__heading">预检方式</h3>'],
  ['aria-label="PM FOK 预检方式"', 'aria-label="预检方式"'],
  [
    '经典预检沿用线上检查流程；动态复核预检只等待最新订单簿，检查限价与足额深度，并保留本地锁盘、赛况复核。\n            钱包在账号加载、解锁时准备；动态复核的校时在双腿预检前完成。保存后对新 FOK 尝试生效，GTC 不受此选项影响。',
    '预检方式与下单模式分别配置。经典预检沿用现有检查流程；动态复核预检检查最新盘口的限价与足额深度，并保留锁盘和赛况复核。\n            保存后对新的预检尝试生效，进行中的预检沿用原配置。',
  ],
];
export function restorePmBookSettingsSource(file, source, required = false) {
  if (file !== PM_BOOK_SETTINGS_TAB) return source;
  let result = source.replaceAll("\r\n", "\n");
  for (const [before, after] of labels) {
    if (!result.includes(after)) continue;
    assert.equal(result.split(after).length, 2, "unique, exact preflight setting label");
    result = result.replace(after, before);
  }
  if (!required && !result.includes("PmBookSettings")) return source;
  for (const addition of additions) {
    assert.equal(result.split(addition).length, 2, "unique, exact local book settings UI attachment");
    result = result.replace(addition, "");
  }
  return result;
}
