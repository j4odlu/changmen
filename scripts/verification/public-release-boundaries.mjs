// [changmen 扩展] 本候选不增加任何公开 action；实际已发布模块必须全文相等。
import assert from 'node:assert/strict';
import { gitSource, moduleTokens, replaceExact } from './fok-exact-boundaries.mjs';
export const publicFiles = ['server/backend/core/esport-api/account_client_routes.ts','server/backend/core/esport-api/pm_pf_routes.ts','server/backend/core/account/admin_orders.js','client/web/src/shared/adminOrderDisplay.ts','client/web/src/types/extensionPrefs.ts'];
// [changmen 扩展] 只恢复已经提交的 action 名单和 RAY 配置迁移，其余公共模块继续全文比较。
export function restoreCommittedPublicAdditions(file, source) {
  if (file.endsWith('pm_pf_routes.ts')) {
    const original='["Pm_GtcCreate", "Pm_GtcCommand", "Pm_GtcList", "Pm_GtcOrders", "Pm_GtcSaveOrders"]';
    if (source.includes('"Pm_GtcRecover"'))
      return replaceExact(source,'["Pm_GtcCreate", "Pm_GtcCommand", "Pm_GtcList", "Pm_GtcRecover", "Pm_GtcOrders", "Pm_GtcMonitorOrders", "Pm_GtcSaveOrders"]',original);
    if (source.includes('"Pm_GtcMonitorOrders"'))
      return replaceExact(source,'["Pm_GtcCreate", "Pm_GtcCommand", "Pm_GtcList", "Pm_GtcOrders", "Pm_GtcMonitorOrders", "Pm_GtcSaveOrders"]',original);
  }
  if (file==='client/web/src/types/extensionPrefs.ts' && !source.includes('monitorMinutes')) {
    const commit='2391dc9df446dcb7ed85030a3faca3696b0d0da7';
    assert.deepEqual(moduleTokens(source),moduleTokens(gitSource(commit,file)),'complete committed RAY preference migration');
    return gitSource(`${commit}^`,file);
  }
  return source;
}
export function verifyActualPublicModule(file,current,original) {
  assert(publicFiles.includes(file),'unknown public module');
  assert.equal(typeof original,'string',`Missing captured source: ${file}`);
  const source=restoreCommittedPublicAdditions(file,current);
  assert.deepEqual(moduleTokens(source),moduleTokens(restoreCommittedPublicAdditions(file,original)),`${file}: complete actual public module after committed additions`);
  return {source};
}
