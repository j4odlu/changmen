// [changmen 扩展] 仅还原用户指定的展示名称；配置值、默认值及逻辑继续逐字核验旧基线。
import assert from "node:assert/strict";

const labels = {
  "client/web/src/components/user/tabs/UserDiagExtensionsTab.vue": [
    ["原有预检沿用线上检查流程；优化预检减少重复赛况查询并更新过期判断。", "经典预检沿用线上检查流程；动态复核预检减少重复赛况查询并更新过期判断。"],
    ['<el-radio-button value="legacy">原有预检（默认）</el-radio-button>', '<el-radio-button value="legacy">经典预检（默认）</el-radio-button>'],
    ['<el-radio-button value="optimized">优化预检</el-radio-button>', '<el-radio-button value="optimized">动态复核预检</el-radio-button>'],
  ],
  "packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight.ts": [
    ['"PM 优化预检状态校验失败，请新建投注尝试"', '"PM 动态复核预检状态校验失败，请新建投注尝试"'],
  ],
};

export function restorePmPreflightLabels(file, source) {
  for (const [before, after] of labels[file] ?? []) {
    if (!source.includes(after)) continue;
    assert.equal(source.split(after).length, 2, file + ": exact PM preflight display label");
    source = source.replace(after, before);
  }
  return source;
}
